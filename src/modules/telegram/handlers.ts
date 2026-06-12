import {
  Bot,
  InputFile,
  type Context as GrammyContext,
  type NextFunction,
} from "grammy";
import type { LlmClient, ResponseInputItem } from "../llm/client.js";
import type { McpService } from "../mcp/service.js";
import type { MemoryService } from "../memory/service.js";
import type { ChatLogService } from "../chatLog/service.js";
import type { ChatConfigService } from "../chatConfig/service.js";
import type { UserConfigService } from "../userConfig/service.js";
import type { SpeechService } from "../speech/service.js";
import type { AuditService } from "../audit/service.js";
import type {
  Contributions,
  TelegramCommand,
  ToolDefinition,
} from "../../core/module.js";
import { tenantFromGrammy, threadKey } from "../../core/tenant.js";
import { resolveCredentials, hasAccess, type AccessDeps } from "./access.js";
import { runChatLoop } from "./chat.js";
import {
  buildDraftMarkdown,
  buildFinalReply,
  createChatActionTicker,
  createDraftManager,
  ctxAudit,
  extractLogEntry,
  fmtError,
  senderTag,
  sendRichReply,
  serializeError,
  toDataUrl,
  type ToolCallRecord,
} from "./helpers.js";
import { cleanMd } from "../../utils/markdown.js";
import { log } from "../../utils/log.js";

export interface TelegramDeps {
  llm: LlmClient;
  mcp: McpService;
  memory: MemoryService;
  chatLog: ChatLogService;
  chatConfig: ChatConfigService;
  userConfig: UserConfigService;
  speech: SpeechService;
  audit: AuditService;
  botToken: string;
  allowedIds: Set<number>;
  webappUrl: string;
  defaultBaseUrl: string;
  defaultModel: string;
}

const IMAGE_CMD_RE = /^\/image(?:@\S+)?\s*([\s\S]*)$/;

export function installTelegram(
  bot: Bot,
  deps: TelegramDeps,
  contributions: Contributions
): void {
  const access: AccessDeps = {
    chatConfig: deps.chatConfig,
    userConfig: deps.userConfig,
    allowedIds: deps.allowedIds,
    defaultBaseUrl: deps.defaultBaseUrl,
    defaultModel: deps.defaultModel,
  };

  // --- in-process per-thread conversation memory + lightweight rate-limit ---
  const memory = new Map<string, ResponseInputItem[]>();
  const lastCall = new Map<string, number>();

  const storeItems = (key: string, ...items: ResponseInputItem[]) => {
    if (!memory.has(key)) memory.set(key, []);
    const list = memory.get(key)!;
    list.push(...items);
    while (list.length > 30) list.shift();
  };

  const canRespond = (key: string) => {
    const now = Date.now();
    const prev = lastCall.get(key) ?? 0;
    if (now - prev < 2000) return false;
    lastCall.set(key, now);
    return true;
  };

  const sanitizeHistory = (items: ResponseInputItem[]): ResponseInputItem[] => {
    if (deps.llm.supportsImages() !== false) return items;
    return items.map((item) => {
      const m = item as { type?: string; content?: unknown };
      if (m.type !== "message" || !Array.isArray(m.content)) return item;
      const parts = (m.content as { type: string }[]).filter(
        (p) => p.type !== "input_image"
      );
      if (parts.length === 0) {
        return { ...item, content: [{ type: "input_text", text: "[image]" }] } as ResponseInputItem;
      }
      return { ...item, content: parts } as ResponseInputItem;
    });
  };

  // --- Bot error handler & advertised commands ---
  bot.catch((err) => log.error(serializeError(err), "Unhandled bot error"));

  const allCommands: TelegramCommand[] = [
    ...contributions.commands,
    {
      name: "reset",
      description: "Reset conversation context",
      public: true,
      handler: async (ctx, tenant) => {
        const tk = threadKey(tenant);
        memory.delete(tk);
        await ctx.reply("Context reset. Memories are still saved — use /forget to clear them.");
      },
    },
    {
      name: "image",
      description: "Generate an image from a text prompt",
      handler: async (ctx, tenant) => {
        const prompt = ctx.match?.toString().trim();
        if (!prompt) {
          await ctx.reply("Provide a description after /image, e.g. /image a cat on the moon");
          return;
        }

        const tk = threadKey(tenant);
        if (!canRespond(tk)) return;

        const t0 = Date.now();
        log.info({ chatId: tenant.chatId, userId: tenant.userId }, "Image generation");

        const actionInterval = setInterval(() => {
          ctx.api.sendChatAction(tenant.chatId, "upload_photo").catch(() => {});
        }, 4000);

        try {
          await ctx.api.sendChatAction(tenant.chatId, "upload_photo");
          const buffer = await deps.llm.generateImage(prompt);

          if (!buffer) {
            await ctx.reply("No image was generated. Try a different prompt.", {
              reply_to_message_id: ctx.message!.message_id,
            });
            deps.audit.log({
              ...ctxAudit(ctx),
              msgType: "image",
              command: "/image",
              inputLen: prompt.length,
              outputLen: 0,
              latencyMs: Date.now() - t0,
              status: "ok",
            });
            return;
          }

          await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
            reply_to_message_id: ctx.message!.message_id,
          });
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType: "image",
            command: "/image",
            inputLen: prompt.length,
            outputLen: 0,
            latencyMs: Date.now() - t0,
            status: "ok",
          });
        } catch (e) {
          const ms = Date.now() - t0;
          log.error({ ...serializeError(e), latencyMs: ms }, "Image generation failed");
          await ctx
            .reply("Failed to generate the image. Please try again.", {
              reply_to_message_id: ctx.message!.message_id,
            })
            .catch(() => {});
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType: "image",
            command: "/image",
            inputLen: prompt.length,
            outputLen: 0,
            latencyMs: ms,
            status: "error",
            errorMsg: fmtError(e),
          });
        } finally {
          clearInterval(actionInterval);
        }
      },
    },
    {
      name: "config",
      description: "Configure API credentials for this chat",
      public: true,
      handler: async (ctx) => {
        const { InlineKeyboard } = await import("grammy");
        await ctx.reply("Open the settings panel to configure your bot:", {
          reply_markup: new InlineKeyboard().webApp("Open Settings", deps.webappUrl),
        });
      },
    },
  ];

  // Advertise commands once.
  void bot.api.setMyCommands(
    allCommands
      .map((c) => ({ command: c.name, description: c.description }))
      .filter(uniqByCommand)
  );

  // --- Access gate ---
  const PUBLIC_COMMANDS = new Set(allCommands.filter((c) => c.public).map((c) => c.name));
  const OUR_COMMANDS = new Set(allCommands.map((c) => c.name));

  bot.use(async (ctx: GrammyContext, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next();

    if (ctx.callbackQuery?.data?.startsWith("cfg:")) return next();

    const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    const botUsername = ctx.me?.username ?? "";
    const text = ctx.message?.text ?? ctx.message?.caption ?? "";

    const cmdMatch = text.match(/^\/(\w+)(?:@(\S+))?/);
    const isOurCommand = cmdMatch
      ? OUR_COMMANDS.has(cmdMatch[1]) && (!cmdMatch[2] || cmdMatch[2] === botUsername)
      : false;

    // In groups, ignore commands addressed to other bots entirely.
    if (isGroup && cmdMatch && !isOurCommand) return;

    if (isOurCommand && PUBLIC_COMMANDS.has(cmdMatch![1])) return next();

    if (!hasAccess(access, chatId, ctx.from?.id)) {
      const isMention = botUsername ? text.includes(`@${botUsername}`) : false;
      const isDirected = !isGroup || isMention || isOurCommand;
      if (isDirected) {
        await ctx.reply(
          "You need to provide an API key to use this bot. Use /config to set one up."
        );
      }
      return;
    }
    return next();
  });

  // --- Group message logging middleware ---
  bot.on("message", async (ctx, next) => {
    if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
      const entry = extractLogEntry(ctx);
      const tenant = tenantFromGrammy(ctx);
      if (deps.chatLog.log(tenant.chatId, entry, ctx.chat.title)) {
        void deps.chatLog.summarize(
          tenant.chatId,
          resolveCredentials(access, tenant.chatId, tenant.userId)
        );
      }
    }
    return next();
  });

  // --- Register commands collected via contributions + telegram-owned ---
  for (const cmd of allCommands) {
    bot.command(cmd.name, async (ctx) => {
      const tenant = tenantFromGrammy(ctx);
      await cmd.handler(ctx, tenant);
    });
  }

  // --- Register generic contributions (callback_query handlers etc.) ---
  for (const h of [...contributions.telegramHandlers].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100)
  )) {
    const selectors = Array.isArray(h.on) ? h.on : [h.on];
    for (const sel of selectors) {
      bot.on(sel as never, async (ctx, next) => {
        const tenant = tenantFromGrammy(ctx);
        await h.handler(ctx, tenant, next);
      });
    }
  }

  // --- Built-in tools (memory) come from contributions ---
  const builtinTools: ToolDefinition[] = contributions.tools;

  // --- Text handler ---
  bot.on("message:text", async (ctx) => {
    const isPM = ctx.chat.type === "private";
    const mention = ctx.message.text.includes(`@${ctx.me.username}`);
    if (!isPM && !mention) return;

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    if (!canRespond(tk)) return;

    void (async () => {
      const t0 = Date.now();
      log.info({ chatId: tenant.chatId, userId: tenant.userId }, "Incoming text message");

      const creds = resolveCredentials(access, tenant.chatId, tenant.userId);
      const tag = senderTag(ctx);
      const inputText = ctx.message.text || "";
      const userItem: ResponseInputItem = {
        type: "message",
        role: "user",
        content: tag + inputText,
      };
      const history = sanitizeHistory(memory.get(tk) || []);
      const inputItems: ResponseInputItem[] = [...history.slice(-20), userItem];

      const draft = createDraftManager(ctx);
      const actionTicker = createChatActionTicker(ctx, "typing");
      const toolCallHistory: ToolCallRecord[] = [];

      let lastDraftTs = 0;
      const onChunk = (snapshot: string) => {
        const now = Date.now();
        if (now - lastDraftTs < 300) return;
        lastDraftTs = now;
        if (toolCallHistory.length > 0) {
          void draft.send(buildDraftMarkdown(toolCallHistory, snapshot));
        } else {
          void draft.send(snapshot);
        }
      };
      const onToolCalls = (calls: ToolCallRecord[]) => {
        toolCallHistory.push(...calls);
        void draft.send(buildDraftMarkdown(toolCallHistory, "Thinking..."));
      };

      try {
        actionTicker.start();
        const text = cleanMd(
          await runChatLoop(
            {
              llm: deps.llm,
              mcp: deps.mcp,
              memory: deps.memory,
              chatLog: deps.chatLog,
              userConfig: deps.userConfig,
              builtinTools,
            },
            tenant,
            inputItems,
            creds,
            onChunk,
            onToolCalls
          )
        );

        if (!text) {
          await draft.delete();
          await ctx.reply("I couldn't generate a response. Please try again.", {
            reply_to_message_id: ctx.message.message_id,
          });
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType: "text",
            inputLen: inputText.length,
            outputLen: 0,
            latencyMs: Date.now() - t0,
            status: "ok",
          });
          return;
        }

        storeItems(tk, userItem, {
          type: "message",
          role: "assistant",
          content: text,
        } as ResponseInputItem);

        const chatCfg = deps.chatConfig.get(tenant.chatId);
        if (chatCfg.voiceMode && deps.speech.isTtsAvailable()) {
          await ctx.api.sendChatAction(tenant.chatId, "record_voice");
          const audioBuffer = await deps.speech.synthesize(text);
          if (audioBuffer) {
            await draft.delete();
            await ctx.replyWithVoice(new InputFile(audioBuffer, "response.ogg"), {
              reply_to_message_id: ctx.message.message_id,
            });
            deps.audit.log({
              ...ctxAudit(ctx),
              msgType: "text",
              inputLen: inputText.length,
              outputLen: text.length,
              latencyMs: Date.now() - t0,
              status: "ok",
            });
            return;
          }
          log.warn("Voice mode TTS failed, falling back to text reply");
        }

        const finalText = buildFinalReply(toolCallHistory, text);
        await draft.delete();
        await sendRichReply(ctx, finalText);
        deps.audit.log({
          ...ctxAudit(ctx),
          msgType: "text",
          inputLen: inputText.length,
          outputLen: text.length,
          latencyMs: Date.now() - t0,
          status: "ok",
        });
      } catch (e) {
        const ms = Date.now() - t0;
        log.error({ ...serializeError(e), latencyMs: ms }, "Text handler failed");
        await draft.delete();
        await ctx
          .reply("Something went wrong, please try again.", {
            reply_to_message_id: ctx.message.message_id,
          })
          .catch(() => {});
        deps.audit.log({
          ...ctxAudit(ctx),
          msgType: "text",
          inputLen: inputText.length,
          outputLen: 0,
          latencyMs: ms,
          status: "error",
          errorMsg: fmtError(e),
        });
      } finally {
        actionTicker.stop();
      }
    })();
  });

  // --- Photo handler (image edit or vision) ---
  bot.on("message:photo", async (ctx) => {
    const isPM = ctx.chat.type === "private";
    const captionRaw = ctx.message.caption?.trim() || "";
    const imageMatch = captionRaw.match(IMAGE_CMD_RE);
    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);

    // --- /image command with photo → editing ---
    if (imageMatch) {
      const prompt = imageMatch[1].trim();
      if (!prompt) {
        await ctx.reply("Provide a description after /image, e.g. /image make it cartoon", {
          reply_to_message_id: ctx.message.message_id,
        });
        return;
      }
      if (!canRespond(tk)) return;

      void (async () => {
        const t0 = Date.now();
        log.info({ chatId: tenant.chatId, userId: tenant.userId }, "Image editing");

        const actionInterval = setInterval(() => {
          ctx.api.sendChatAction(tenant.chatId, "upload_photo").catch(() => {});
        }, 4000);

        try {
          await ctx.api.sendChatAction(tenant.chatId, "upload_photo");
          const file = await ctx.api.getFile(ctx.message.photo.pop()!.file_id);
          const photoUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
          const dataUrl = await toDataUrl(photoUrl);
          const buffer = await deps.llm.generateImage(prompt, dataUrl);

          if (!buffer) {
            await ctx.reply("No image was generated. Try a different prompt.", {
              reply_to_message_id: ctx.message.message_id,
            });
            deps.audit.log({
              ...ctxAudit(ctx),
              msgType: "image_edit",
              command: "/image",
              inputLen: prompt.length,
              outputLen: 0,
              latencyMs: Date.now() - t0,
              status: "ok",
            });
            return;
          }

          await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
            reply_to_message_id: ctx.message.message_id,
          });
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType: "image_edit",
            command: "/image",
            inputLen: prompt.length,
            outputLen: 0,
            latencyMs: Date.now() - t0,
            status: "ok",
          });
        } catch (e) {
          const ms = Date.now() - t0;
          log.error({ ...serializeError(e), latencyMs: ms }, "Image editing failed");
          await ctx
            .reply("Failed to edit the image. Please try again.", {
              reply_to_message_id: ctx.message.message_id,
            })
            .catch(() => {});
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType: "image_edit",
            command: "/image",
            inputLen: prompt.length,
            outputLen: 0,
            latencyMs: ms,
            status: "error",
            errorMsg: fmtError(e),
          });
        } finally {
          clearInterval(actionInterval);
        }
      })();
      return;
    }

    // --- Vision analysis ---
    const hasMention = captionRaw.includes(`@${ctx.me.username}`);
    if (!isPM && (!captionRaw || !hasMention)) return;
    if (deps.llm.supportsImages() === false) {
      await ctx.reply(
        "The current model does not support image input. Send text or switch to a vision-capable model.",
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }
    if (!canRespond(tk)) return;

    const creds = resolveCredentials(access, tenant.chatId, tenant.userId);

    void (async () => {
      const t0 = Date.now();
      log.info({ chatId: tenant.chatId, userId: tenant.userId }, "Photo vision request");

      const draft = createDraftManager(ctx);
      const actionTicker = createChatActionTicker(ctx, "typing");
      const toolCallHistory: ToolCallRecord[] = [];

      let lastDraftTs = 0;
      const onChunk = (snapshot: string) => {
        const now = Date.now();
        if (now - lastDraftTs < 300) return;
        lastDraftTs = now;
        if (toolCallHistory.length > 0) {
          void draft.send(buildDraftMarkdown(toolCallHistory, snapshot));
        } else {
          void draft.send(snapshot);
        }
      };
      const onToolCalls = (calls: ToolCallRecord[]) => {
        toolCallHistory.push(...calls);
        void draft.send(buildDraftMarkdown(toolCallHistory, "Thinking..."));
      };

      try {
        actionTicker.start();
        const file = await ctx.api.getFile(ctx.message.photo.pop()!.file_id);
        const telegramUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        const dataUrl = await toDataUrl(telegramUrl);

        const tag = senderTag(ctx);
        const contentParts: { type: string; text?: string; image_url?: string }[] = [];
        if (captionRaw) contentParts.push({ type: "input_text", text: tag + captionRaw });
        else if (tag) contentParts.push({ type: "input_text", text: tag.trim() });
        contentParts.push({ type: "input_image", image_url: dataUrl });

        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content: contentParts as never,
        };
        const history = sanitizeHistory(memory.get(tk) || []);
        const inputItems: ResponseInputItem[] = [...history.slice(-20), userItem];

        const text = cleanMd(
          await runChatLoop(
            {
              llm: deps.llm,
              mcp: deps.mcp,
              memory: deps.memory,
              chatLog: deps.chatLog,
              userConfig: deps.userConfig,
              builtinTools,
            },
            tenant,
            inputItems,
            creds,
            onChunk,
            onToolCalls
          )
        );

        if (!text) {
          await draft.delete();
          await ctx.reply("I couldn't generate a response for this image. Please try again.", {
            reply_to_message_id: ctx.message.message_id,
          });
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType: "photo",
            inputLen: captionRaw.length,
            outputLen: 0,
            latencyMs: Date.now() - t0,
            status: "ok",
          });
          return;
        }

        storeItems(tk, userItem, {
          type: "message",
          role: "assistant",
          content: text,
        } as ResponseInputItem);

        const finalText = buildFinalReply(toolCallHistory, text);
        await draft.delete();
        await sendRichReply(ctx, finalText);
        deps.audit.log({
          ...ctxAudit(ctx),
          msgType: "photo",
          inputLen: captionRaw.length,
          outputLen: text.length,
          latencyMs: Date.now() - t0,
          status: "ok",
        });
      } catch (e) {
        const ms = Date.now() - t0;
        log.error({ ...serializeError(e), latencyMs: ms }, "Photo handler failed");
        await draft.delete();
        await ctx
          .reply("Failed to process the image. Please try again or send text instead.", {
            reply_to_message_id: ctx.message.message_id,
          })
          .catch(() => {});
        deps.audit.log({
          ...ctxAudit(ctx),
          msgType: "photo",
          inputLen: captionRaw.length,
          outputLen: 0,
          latencyMs: ms,
          status: "error",
          errorMsg: fmtError(e),
        });
      } finally {
        actionTicker.stop();
      }
    })();
  });

  // --- Voice handler ---
  bot.on("message:voice", async (ctx) => {
    if (!deps.speech.isSttAvailable()) {
      await ctx.reply(
        "Voice recognition is not configured. Please ask the bot administrator to set up Yandex Cloud SpeechKit.",
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    const isPM = ctx.chat.type === "private";
    const captionRaw = ctx.message.caption?.trim() || "";
    const mention = captionRaw.includes(`@${ctx.me.username}`);
    if (!isPM && !mention) return;

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    if (!canRespond(tk)) return;

    const creds = resolveCredentials(access, tenant.chatId, tenant.userId);

    void (async () => {
      const t0 = Date.now();
      log.info({ chatId: tenant.chatId, userId: tenant.userId }, "Voice message");

      const draft = createDraftManager(ctx);
      const actionTicker = createChatActionTicker(ctx, "typing");
      const toolCallHistory: ToolCallRecord[] = [];

      try {
        actionTicker.start();
        await ctx.api.sendChatAction(tenant.chatId, "typing");

        const file = await ctx.api.getFile(ctx.message.voice.file_id);
        const telegramUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        const audioRes = await fetch(telegramUrl);
        if (!audioRes.ok) {
          throw new Error(`Failed to download voice: ${audioRes.status}`);
        }
        const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

        const recognized = await deps.speech.recognize(audioBuffer);

        if (!recognized) {
          await draft.delete();
          await ctx.reply("Could not recognize speech. Please try again or send text.", {
            reply_to_message_id: ctx.message.message_id,
          });
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType: "voice",
            inputLen: 0,
            outputLen: 0,
            latencyMs: Date.now() - t0,
            status: "error",
            errorMsg: "STT returned empty result",
          });
          return;
        }

        log.info(
          { chatId: tenant.chatId, recognizedLen: recognized.length },
          "STT recognized"
        );

        let lastDraftTs = 0;
        const onChunk = (snapshot: string) => {
          const now = Date.now();
          if (now - lastDraftTs < 300) return;
          lastDraftTs = now;
          if (toolCallHistory.length > 0) {
            void draft.send(buildDraftMarkdown(toolCallHistory, snapshot));
          } else {
            void draft.send(snapshot);
          }
        };
        const onToolCalls = (calls: ToolCallRecord[]) => {
          toolCallHistory.push(...calls);
          void draft.send(buildDraftMarkdown(toolCallHistory, "Thinking..."));
        };

        const tag = senderTag(ctx);
        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content: tag + recognized,
        };
        const history = sanitizeHistory(memory.get(tk) || []);
        const inputItems: ResponseInputItem[] = [...history.slice(-20), userItem];

        const text = cleanMd(
          await runChatLoop(
            {
              llm: deps.llm,
              mcp: deps.mcp,
              memory: deps.memory,
              chatLog: deps.chatLog,
              userConfig: deps.userConfig,
              builtinTools,
            },
            tenant,
            inputItems,
            creds,
            onChunk,
            onToolCalls
          )
        );

        if (!text) {
          await draft.delete();
          await ctx.reply("I couldn't generate a response. Please try again.", {
            reply_to_message_id: ctx.message.message_id,
          });
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType: "voice",
            inputLen: recognized.length,
            outputLen: 0,
            latencyMs: Date.now() - t0,
            status: "ok",
          });
          return;
        }

        storeItems(tk, userItem, {
          type: "message",
          role: "assistant",
          content: text,
        } as ResponseInputItem);

        if (deps.speech.isTtsAvailable()) {
          await ctx.api.sendChatAction(tenant.chatId, "record_voice");
          const audioBuffer = await deps.speech.synthesize(text);
          if (audioBuffer) {
            await draft.delete();
            await ctx.replyWithVoice(new InputFile(audioBuffer, "response.ogg"), {
              reply_to_message_id: ctx.message.message_id,
            });
            deps.audit.log({
              ...ctxAudit(ctx),
              msgType: "voice",
              inputLen: recognized.length,
              outputLen: text.length,
              latencyMs: Date.now() - t0,
              status: "ok",
            });
            return;
          }
          log.warn("TTS synthesis failed, falling back to text reply");
        }

        const finalText = buildFinalReply(toolCallHistory, text);
        await draft.delete();
        await sendRichReply(ctx, finalText);
        deps.audit.log({
          ...ctxAudit(ctx),
          msgType: "voice",
          inputLen: recognized.length,
          outputLen: text.length,
          latencyMs: Date.now() - t0,
          status: "ok",
        });
      } catch (e) {
        const ms = Date.now() - t0;
        log.error({ ...serializeError(e), latencyMs: ms }, "Voice handler failed");
        await draft.delete();
        await ctx
          .reply("Failed to process the voice message. Please try again or send text.", {
            reply_to_message_id: ctx.message.message_id,
          })
          .catch(() => {});
        deps.audit.log({
          ...ctxAudit(ctx),
          msgType: "voice",
          inputLen: 0,
          outputLen: 0,
          latencyMs: ms,
          status: "error",
          errorMsg: fmtError(e),
        });
      } finally {
        actionTicker.stop();
      }
    })();
  });
}

function uniqByCommand<T extends { command: string }>(
  v: T,
  i: number,
  arr: T[]
): boolean {
  return arr.findIndex((x) => x.command === v.command) === i;
}
