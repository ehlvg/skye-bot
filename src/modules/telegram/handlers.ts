import {
  Bot,
  InlineKeyboard,
  InputFile,
  type Context as GrammyContext,
  type NextFunction,
} from "grammy";
import type { InputChecklist, Message, ReplyParameters } from "grammy/types";
import type { LlmClient, ResponseInputItem } from "../llm/client.js";
import type { McpService } from "../mcp/service.js";
import type { MemoryService } from "../memory/service.js";
import type { ChatLogService } from "../chatLog/service.js";
import type { ChatConfigService } from "../chatConfig/service.js";
import type { UserConfigService } from "../userConfig/service.js";
import type { SpeechService } from "../speech/service.js";
import type { AuditService } from "../audit/service.js";
import type { SandboxService } from "../sandbox/service.js";
import type { ProactiveService } from "../proactive/service.js";
import type { Contributions, TelegramCommand, ToolDefinition } from "../../core/module.js";
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
  reactSafely,
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
  sandbox?: SandboxService;
  proactive?: ProactiveService;
  botToken: string;
  allowedIds: Set<number>;
  webappUrl: string;
  defaultBaseUrl: string;
  defaultModel: string;
}

const IMAGE_CMD_RE = /^\/image(?:@\S+)?\s*([\s\S]*)$/;
const TEXT_BURST_DELAY_MS = 1200;
const TEXT_HISTORY_LIMIT = 40;
const TRACKED_CHATS = new Set<number>();
const SUPPORTED_TEXT_MIME_RE =
  /^(text\/|application\/(json|xml|csv|javascript|x-javascript|typescript|x-typescript|sql))/i;
const SUPPORTED_TEXT_EXT_RE =
  /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|css|html|xml|yaml|yml|toml|ini|sql|log)$/i;

type QueuedTextMessage = {
  ctx: GrammyContext & { message: Message.TextMessage };
  tenant: ReturnType<typeof tenantFromGrammy>;
  text: string;
  tag: string;
};

type ImageControl = {
  prompt: string;
  imageUrl?: string;
};

export function installTelegram(bot: Bot, deps: TelegramDeps, contributions: Contributions): void {
  const access: AccessDeps = {
    chatConfig: deps.chatConfig,
    userConfig: deps.userConfig,
    allowedIds: deps.allowedIds,
    defaultBaseUrl: deps.defaultBaseUrl,
    defaultModel: deps.defaultModel,
  };

  // --- per-thread serialized work queue + short burst buffer for Telegram typing ---
  const queues = new Map<string, Promise<void>>();
  const textBursts = new Map<string, { timer: NodeJS.Timeout; items: QueuedTextMessage[] }>();
  const imageControls = new Map<string, ImageControl>();
  // Reference images collected per-thread, consumed by the generate_image tool.
  const threadReferenceImages = new Map<string, string[]>();
  // Media-group (album) accumulator: key=media_group_id, value=all photos in arrival order.
  // Telegram delivers album photos as separate messages within ~1s; we buffer them and
  // process once we have the caption + a short grace period has elapsed.
  const mediaGroups = new Map<
    string,
    {
      tenant: ReturnType<typeof tenantFromGrammy>;
      ctxs: GrammyContext[];
      timer: NodeJS.Timeout;
    }
  >();
  const MEDIA_GROUP_GRACE_MS = 700;

  const MENTION_RE = /(^|[^\p{L}\p{N}_])(skye|скай)(?=[^\p{L}\p{N}_]|$)/iu;
  const botUserId = () => bot.botInfo.id;
  const botUsername = () => bot.botInfo.username?.toLowerCase() ?? "";

  function isMentioned(ctx: GrammyContext): boolean {
    const text = ctx.message?.text ?? ctx.message?.caption ?? "";
    if (!text) return false;
    if (MENTION_RE.test(text)) return true;
    const uname = botUsername();
    if (uname && text.toLowerCase().includes(`@${uname}`)) return true;
    return false;
  }

  function isReplyToBot(ctx: GrammyContext): boolean {
    const reply = ctx.message && "reply_to_message" in ctx.message
      ? ctx.message.reply_to_message
      : undefined;
    return reply?.from?.id === botUserId();
  }

  function isDirectedAtBot(ctx: GrammyContext): boolean {
    const isPM = ctx.chat?.type === "private";
    if (isPM) return true;
    return isMentioned(ctx) || isReplyToBot(ctx);
  }

  async function collectReferenceImages(ctx: GrammyContext): Promise<string[]> {
    const reply =
      ctx.message && "reply_to_message" in ctx.message
        ? ctx.message.reply_to_message
        : undefined;
    const images: string[] = [];
    const targets: { photo?: Message["photo"] }[] = [];
    if (reply?.photo?.length) targets.push(reply);
    if (ctx.message?.photo?.length) targets.push(ctx.message);
    for (const t of targets) {
      if (!t.photo?.length) continue;
      try {
        const file = await ctx.api.getFile(t.photo[t.photo.length - 1].file_id);
        const url = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        images.push(await toDataUrl(url));
      } catch (e) {
        log.warn({ err: e }, "Failed to download reference image");
      }
    }
    return images;
  }

  async function downloadPhotos(ctxs: GrammyContext[]): Promise<string[]> {
    const out: string[] = [];
    for (const c of ctxs) {
      if (!c.message?.photo?.length) continue;
      try {
        const file = await c.api.getFile(c.message.photo[c.message.photo.length - 1].file_id);
        const url = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        out.push(await toDataUrl(url));
      } catch (e) {
        log.warn({ err: e }, "Failed to download album photo");
      }
    }
    return out;
  }

  const generateImageTool: ToolDefinition = {
    name: "generate_image",
    description:
      "Generate a new image or edit an existing reference image. Use this when the user asks you to create, draw, generate, edit, or modify an image. If reference images were provided in the conversation, they will be used as the basis for editing. Output only the prompt — the image is sent to the user automatically.",
    parameters: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "The image generation/editing prompt. Be concrete and descriptive. For editing, describe the full desired result (not just the change).",
        },
      },
      required: ["prompt"],
    },
    execute: async (args, tenant) => {
      const prompt = String(args.prompt ?? "");
      if (!prompt) return "No prompt provided for image generation.";

      const tk = threadKey(tenant);
      const references = threadReferenceImages.get(tk) ?? [];
      const referenceUrls = references.length > 0 ? references : undefined;
      const referenceCount = references.length;

      try {
        const buffer = await deps.llm.generateImage(prompt, referenceUrls);
        if (!buffer) {
          storeConversation(
            tenant,
            "tool",
            { name: "generate_image", prompt, references: referenceCount, result: "no image" },
            `generate_image(prompt=${prompt.slice(0, 100)}, refs=${referenceCount}) -> no image`
          );
          return "No image was generated. Try a different prompt.";
        }

        const sent = await bot.api.sendPhoto(
          tenant.chatId,
          new InputFile(buffer, "image.png"),
          {
            ...(tenant.threadId != null ? { message_thread_id: tenant.threadId } : {}),
            reply_markup: imageKeyboard(),
          }
        );
        imageControls.set(imageControlKey(tenant.chatId, sent.message_id), {
          prompt,
          imageUrl: references[0],
        });
        storeConversation(
          tenant,
          "tool",
          {
            name: "generate_image",
            prompt,
            references: referenceCount,
            messageId: sent.message_id,
          },
          `generate_image(prompt=${prompt.slice(0, 100)}, refs=${referenceCount}) -> sent image (message_id ${sent.message_id})`
        );
        return `Image generated and sent to the user (message_id: ${sent.message_id}).`;
      } catch (e) {
        log.error({ err: e }, "generate_image tool failed");
        const errMsg = fmtError(e);
        storeConversation(
          tenant,
          "tool",
          { name: "generate_image", prompt, references: referenceCount, error: errMsg },
          `generate_image(prompt=${prompt.slice(0, 100)}, refs=${referenceCount}) -> FAILED: ${errMsg}`
        );
        return `Failed to generate image: ${errMsg}`;
      }
    },
  };

  const enqueue = (key: string, job: () => Promise<void>) => {
    const previous = queues.get(key) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(job)
      .finally(() => {
        if (queues.get(key) === next) queues.delete(key);
      });
    queues.set(key, next);
    void next;
  };

  const maybeReactProactively = (
    ctx: GrammyContext,
    tenant: ReturnType<typeof tenantFromGrammy>
  ): void => {
    const proactive = deps.proactive;
    if (!proactive || !proactive.isEnabled()) return;
    if (!ctx.message?.message_id) return;
    const triggerMessageId = ctx.message.message_id;
    const chatId = tenant.chatId;
    const chatTitle = ctx.chat?.title ?? "Group";
    const creds = resolveCredentials(access, chatId, tenant.userId);

    void (async () => {
      const decision = await proactive.maybeReact(chatId, triggerMessageId, chatTitle, creds);
      if (!decision || decision.kind === "none") return;
      const targetId = decision.targetMessageId ?? triggerMessageId;

      try {
        if (decision.kind === "emoji" && decision.emoji) {
          await bot.api.raw.setMessageReaction({
            chat_id: chatId,
            message_id: targetId,
            reaction: [{ type: "emoji", emoji: decision.emoji } as never],
            is_big: false,
          });
          log.info(
            { chatId, targetId, emoji: decision.emoji, reason: decision.reason },
            "Proactive emoji reaction"
          );
        } else if (decision.kind === "text" && decision.text) {
          const sent = await bot.api.sendMessage(chatId, decision.text, {
            reply_parameters: { message_id: targetId },
            ...(tenant.threadId != null
              ? { message_thread_id: tenant.threadId }
              : {}),
          });
          storeConversation(
            tenant,
            "assistant",
            { kind: "proactive_reply", text: decision.text, targetMessageId: targetId },
            `[proactive reply to msg ${targetId}] ${decision.text}`
          );
          log.info(
            { chatId, targetId, text: decision.text, reason: decision.reason, messageId: sent.message_id },
            "Proactive text reaction"
          );
        }
      } catch (e) {
        log.warn(
          { err: e, chatId, targetId, kind: decision.kind },
          "Failed to apply proactive reaction"
        );
      }
    })();
  };

  const sanitizeHistory = (items: ResponseInputItem[]): ResponseInputItem[] => {
    if (deps.llm.supportsImages() !== false) return items;
    return items.map((item) => {
      const m = item as { type?: string; content?: unknown };
      if (m.type !== "message" || !Array.isArray(m.content)) return item;
      const parts = (m.content as { type: string }[]).filter((p) => p.type !== "input_image");
      if (parts.length === 0) {
        return { ...item, content: [{ type: "input_text", text: "[image]" }] } as ResponseInputItem;
      }
      return { ...item, content: parts } as ResponseInputItem;
    });
  };

  const historyFor = (tenant: ReturnType<typeof tenantFromGrammy>): ResponseInputItem[] => {
    const tk = threadKey(tenant);
    const rows = deps.chatLog.listConversation(tenant.chatId, tk, TEXT_HISTORY_LIMIT);
    const items: ResponseInputItem[] = [];
    for (const row of rows) {
      if (row.role === "tool") {
        const c = row.content as { call_id?: string; output?: string };
        if (c.call_id && typeof c.output === "string") {
          items.push({
            type: "function_call_output",
            call_id: c.call_id,
            output: c.output,
          } as ResponseInputItem);
        }
        continue;
      }
      const c = row.content as { type?: string } | string | unknown[];
      if (
        typeof c === "object" &&
        c !== null &&
        !Array.isArray(c) &&
        c.type === "function_call"
      ) {
        items.push(c as ResponseInputItem);
        continue;
      }
      // Normalize content for the chat API:
      // - string content → use as-is
      // - array content (Responses API parts) → use as-is (sanitizeHistory will strip images)
      // - object content (our metadata records like image edits, proactive replies)
      //   → fall back to row.text so the provider gets a plain string, not a map
      const content =
        typeof c === "string" || Array.isArray(c) ? c : row.text;
      items.push({
        type: "message",
        role: row.role === "assistant" ? "assistant" : "user",
        content,
      } as ResponseInputItem);
    }
    return sanitizeHistory(items);
  };

  const storeConversation = (
    tenant: ReturnType<typeof tenantFromGrammy>,
    role: "user" | "assistant" | "tool",
    content: unknown,
    text: string,
    messageId?: number
  ) => {
    deps.chatLog.appendConversation(tenant.chatId, threadKey(tenant), {
      role,
      content,
      text: text.slice(0, 12000),
      ...(messageId != null ? { messageId } : {}),
    });
  };

  const replyContext = (ctx: GrammyContext): string => {
    const reply =
      ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
    if (!reply) return "";
    const stored =
      reply.message_id != null
        ? deps.chatLog.findConversationText(ctx.chat!.id, reply.message_id)
        : undefined;
    const text =
      stored ||
      ("text" in reply && reply.text) ||
      ("caption" in reply && reply.caption) ||
      ("photo" in reply && reply.photo ? "[photo]" : "") ||
      ("voice" in reply && reply.voice ? "[voice message]" : "") ||
      ("document" in reply && reply.document
        ? `[document: ${reply.document.file_name ?? "file"}]`
        : "");
    if (!text) return "";
    return `Context: the user is replying to this message:\n${text.slice(0, 2000)}\n\n`;
  };

  const replyImageContextNote = (ctx: GrammyContext): string => {
    const reply =
      ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
    if (!reply?.photo?.length) return "";
    return "The replied-to message contains an image. It has been collected as a reference for image generation/editing.\n\n";
  };

  const downloadTelegramFile = async (fileId: string) => {
    const file = await bot.api.getFile(fileId);
    const telegramUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
    const res = await fetch(telegramUrl);
    if (!res.ok) throw new Error(`Failed to download Telegram file: ${res.status}`);
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      path: file.file_path ?? "",
    };
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
        deps.chatLog.clearConversation(tenant.chatId, tk);
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

          const sent = await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
            reply_to_message_id: ctx.message!.message_id,
            reply_markup: imageKeyboard(),
          });
          imageControls.set(imageControlKey(tenant.chatId, sent.message_id), { prompt });
          storeConversation(
            tenant,
            "assistant",
            { kind: "image_generated", prompt, messageId: sent.message_id },
            `generated image: ${prompt.slice(0, 200)} (message_id ${sent.message_id})`
          );
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
          storeConversation(
            tenant,
            "assistant",
            { kind: "image_failed", prompt, error: fmtError(e) },
            `image generation failed: ${fmtError(e)}`
          );
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
        await ctx.reply("Open the settings panel to configure your bot:", {
          reply_markup: new InlineKeyboard().webApp("Open Settings", deps.webappUrl),
        });
      },
    },
    {
      name: "status",
      description: "Show bot capabilities and current chat state",
      public: true,
      handler: async (ctx, tenant) => {
        const chatCfg = deps.chatConfig.get(tenant.chatId);
        const userCfg = tenant.userId ? deps.userConfig.get(tenant.userId) : undefined;
        const mcpTools = tenant.userId ? deps.mcp.toolsFor(tenant.userId) : [];
        const vision = deps.llm.supportsImages();
        const lines = [
          "**Skye status**",
          "",
          `Chat: \`${tenant.chatType}\`${tenant.threadId ? ` / topic ${tenant.threadId}` : ""}`,
          `Model: \`${userCfg?.model ?? deps.defaultModel}\``,
          `Vision: ${vision === false ? "off" : vision === true ? "on" : "unknown"}`,
          `Voice input: ${deps.speech.isSttAvailable() ? "on" : "off"}`,
          `Voice replies: ${chatCfg.voiceMode ? "on" : "off"}`,
          `TTS: ${deps.speech.isTtsAvailable() ? "on" : "off"}`,
          `Memories: ${deps.memory.list(tenant.chatId).length}`,
          `Context items: ${deps.chatLog.countConversation(tenant.chatId, threadKey(tenant))}`,
          `MCP tools: ${mcpTools.length}`,
          `Sandbox: ${deps.sandbox?.isEnabled() ? "on" : "off"}`,
        ];
        await sendRichReply(ctx, lines.join("\n"));
      },
    },
    {
      name: "catchup",
      description: "Summarize recent group context",
      public: true,
      handler: async (ctx, tenant) => {
        const context = deps.chatLog.context(tenant.chatId);
        if (!context) {
          await ctx.reply("No group context yet.", {
            reply_to_message_id: ctx.message?.message_id,
          });
          return;
        }
        const parts = [
          `**${context.chatTitle} catch-up**`,
          context.recentLog ? `\n**Recent messages**\n${context.recentLog}` : "",
        ];
        await sendRichReply(ctx, parts.filter(Boolean).join("\n"));
      },
    },
  ];

  // Advertise commands once.
  void bot.api.setMyCommands(
    allCommands.map((c) => ({ command: c.name, description: c.description })).filter(uniqByCommand)
  );

  // --- Access gate ---
  const PUBLIC_COMMANDS = new Set(allCommands.filter((c) => c.public).map((c) => c.name));
  const OUR_COMMANDS = new Set(allCommands.map((c) => c.name));

  bot.use(async (ctx: GrammyContext, next: NextFunction) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return next();

    if (ctx.callbackQuery?.data?.startsWith("cfg:")) return next();

    const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
    const meUsername = ctx.me?.username ?? "";
    const text = ctx.message?.text ?? ctx.message?.caption ?? "";

    const cmdMatch = text.match(/^\/(\w+)(?:@(\S+))?/);
    const isOurCommand = cmdMatch
      ? OUR_COMMANDS.has(cmdMatch[1]) && (!cmdMatch[2] || cmdMatch[2] === meUsername)
      : false;

    // In groups, ignore commands addressed to other bots entirely.
    if (isGroup && cmdMatch && !isOurCommand) return;

    if (isOurCommand && PUBLIC_COMMANDS.has(cmdMatch![1])) return next();

    if (!hasAccess(access, chatId, ctx.from?.id)) {
      const directed = isDirectedAtBot(ctx);
      if (directed) {
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
      const chatId = ctx.chat.id;
      if (!TRACKED_CHATS.has(chatId)) {
        deps.chatLog.loadChatLog(chatId);
        TRACKED_CHATS.add(chatId);
      }
      const entry = extractLogEntry(ctx);
      const tenant = tenantFromGrammy(ctx);
      deps.chatLog.log(tenant.chatId, entry, ctx.chat.title);
      maybeReactProactively(ctx, tenant);
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

  // --- Built-in tools (memory + image generation) come from contributions ---
  const builtinTools: ToolDefinition[] = [...contributions.tools, generateImageTool];

  const maybeSendChecklist = async (
    ctx: GrammyContext,
    text: string,
    inputText: string
  ): Promise<Message | undefined> => {
    if (!shouldPreferChecklist(inputText, text)) return undefined;
    const checklist = extractChecklist(text);
    if (!checklist) return undefined;

    if (ctx.businessConnectionId) {
      try {
        return await ctx.replyWithChecklist(checklist, {
          reply_parameters: replyParametersFor(ctx),
        });
      } catch (e) {
        log.warn({ err: e }, "Native checklist failed, falling back to rich Markdown");
      }
    }
    return undefined;
  };

  const runLlmReply = async (
    ctx: GrammyContext,
    tenant: ReturnType<typeof tenantFromGrammy>,
    userItem: ResponseInputItem,
    inputText: string,
    msgType: "text" | "voice" | "photo" | "document" | "audio" | "video_note",
    options: { voiceReply?: boolean } = {}
  ) => {
    const t0 = Date.now();
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
      reactSafely(ctx, "👀");
      actionTicker.start();

      // Persist the user message BEFORE calling the LLM so it survives
      // crashes, timeouts, and failed tool calls.
      storeConversation(
        tenant,
        "user",
        (userItem as { content?: unknown }).content ?? "",
        inputText,
        ctx.message?.message_id
      );

      const creds = resolveCredentials(access, tenant.chatId, tenant.userId);
      const inputItems: ResponseInputItem[] = [...historyFor(tenant).slice(-20), userItem];
      const tk = threadKey(tenant);
      const hasReferenceImages = threadReferenceImages.has(tk);
      const text = cleanMd(
        await runChatLoop(
          {
            llm: deps.llm,
            mcp: deps.mcp,
            memory: deps.memory,
            chatLog: deps.chatLog,
            userConfig: deps.userConfig,
            sandbox: deps.sandbox,
            builtinTools,
            hasReferenceImages,
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
          reply_to_message_id: ctx.message?.message_id,
        });
        deps.audit.log({
          ...ctxAudit(ctx),
          msgType,
          inputLen: inputText.length,
          outputLen: 0,
          latencyMs: Date.now() - t0,
          status: "ok",
        });
        return;
      }

      const shouldVoice =
        options.voiceReply ||
        (deps.chatConfig.get(tenant.chatId).voiceMode && deps.speech.isTtsAvailable());
      if (shouldVoice && deps.speech.isTtsAvailable()) {
        await ctx.api.sendChatAction(tenant.chatId, "record_voice");
        const audioBuffer = await deps.speech.synthesize(text);
        if (audioBuffer) {
          await draft.delete();
          await ctx.replyWithVoice(new InputFile(audioBuffer, "response.ogg"), {
            reply_to_message_id: ctx.message?.message_id,
          });
          reactSafely(ctx, "👍");
          deps.audit.log({
            ...ctxAudit(ctx),
            msgType,
            inputLen: inputText.length,
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
      const checklistMessage = await maybeSendChecklist(ctx, finalText, inputText);
      if (!checklistMessage) await sendRichReply(ctx, finalText);
      reactSafely(ctx, "👍");
      deps.audit.log({
        ...ctxAudit(ctx),
        msgType,
        inputLen: inputText.length,
        outputLen: text.length,
        latencyMs: Date.now() - t0,
        status: "ok",
      });
    } catch (e) {
      const ms = Date.now() - t0;
      log.error({ ...serializeError(e), latencyMs: ms }, `${msgType} handler failed`);
      await draft.delete();
      reactSafely(ctx, "😢");
      await ctx
        .reply("Something went wrong, please try again.", {
          reply_to_message_id: ctx.message?.message_id,
        })
        .catch(() => {});
      deps.audit.log({
        ...ctxAudit(ctx),
        msgType,
        inputLen: inputText.length,
        outputLen: 0,
        latencyMs: ms,
        status: "error",
        errorMsg: fmtError(e),
      });
    } finally {
      actionTicker.stop();
    }
  };

  const flushTextBurst = (key: string) => {
    const burst = textBursts.get(key);
    if (!burst) return;
    clearTimeout(burst.timer);
    textBursts.delete(key);
    const last = burst.items[burst.items.length - 1];
    if (!last) return;

    enqueue(key, async () => {
      const combined = burst.items.map((item) => `${item.tag}${item.text}`).join("\n");
      const content = `${replyContext(last.ctx)}${replyImageContextNote(last.ctx)}${combined}`;
      const userItem: ResponseInputItem = {
        type: "message",
        role: "user",
        content,
      };
      await runLlmReply(last.ctx, last.tenant, userItem, combined, "text");
      threadReferenceImages.delete(key);
    });
  };

  // --- Text handler ---
  bot.on("message:text", async (ctx) => {
    if (!isDirectedAtBot(ctx)) return;

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    reactSafely(ctx, "👀");

    // Collect reference images from replied-to message for the generate_image tool.
    const refs = await collectReferenceImages(ctx);
    if (refs.length > 0) threadReferenceImages.set(tk, refs);

    const existing = textBursts.get(tk);
    if (existing) clearTimeout(existing.timer);
    const items = existing?.items ?? [];
    items.push({
      ctx: ctx as GrammyContext & { message: Message.TextMessage },
      tenant,
      text: ctx.message.text || "",
      tag: senderTag(ctx),
    });
    const timer = setTimeout(() => flushTextBurst(tk), TEXT_BURST_DELAY_MS);
    textBursts.set(tk, { timer, items });
  });

  // --- Photo handler (image edit or vision) ---
  bot.on("message:photo", async (ctx) => {
    const captionRaw = ctx.message.caption?.trim() || "";
    const imageMatch = captionRaw.match(IMAGE_CMD_RE);
    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    const mediaGroupId =
      (ctx.message as Message & { media_group_id?: string }).media_group_id;

    // --- Album / media-group: buffer all photos, process once after grace ---
    if (mediaGroupId) {
      const existing = mediaGroups.get(mediaGroupId);
      if (existing) {
        existing.ctxs.push(ctx);
      } else {
        const entry = {
          tenant,
          ctxs: [ctx],
          timer: undefined as unknown as NodeJS.Timeout,
        };
        entry.timer = setTimeout(() => {
          mediaGroups.delete(mediaGroupId);
          void processMediaGroup(entry.tenant, entry.ctxs);
        }, MEDIA_GROUP_GRACE_MS);
        mediaGroups.set(mediaGroupId, entry);
      }
      return;
    }

    // --- /image command with single photo → editing ---
    if (imageMatch) {
      const prompt = imageMatch[1].trim();
      if (!prompt) {
        await ctx.reply("Provide a description after /image, e.g. /image make it cartoon", {
          reply_to_message_id: ctx.message.message_id,
        });
        return;
      }
      void runImageEditCommand(ctx, tenant, prompt);
      return;
    }

    // --- Vision analysis (single photo sent with a question for Skye) ---
    if (!isDirectedAtBot(ctx)) return;
    if (deps.llm.supportsImages() === false) {
      await ctx.reply(
        "The current model does not support image input. Send text or switch to a vision-capable model.",
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }
    const replyRefs = await collectReferenceImages(ctx);
    if (replyRefs.length > 0) threadReferenceImages.set(tk, replyRefs);
    enqueue(tk, async () => {
      try {
        const file = await ctx.api.getFile(ctx.message.photo.pop()!.file_id);
        const telegramUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        const dataUrl = await toDataUrl(telegramUrl);

        const tag = senderTag(ctx);
        const contentParts: { type: string; text?: string; image_url?: string }[] = [];
        const textPart = `${replyContext(ctx)}${replyImageContextNote(ctx)}${tag}${captionRaw || "Please analyze this image."}`;
        if (textPart) contentParts.push({ type: "input_text", text: textPart });
        else if (tag) contentParts.push({ type: "input_text", text: tag.trim() });
        contentParts.push({ type: "input_image", image_url: dataUrl });

        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content: contentParts as never,
        };
        await runLlmReply(ctx, tenant, userItem, textPart, "photo");
        threadReferenceImages.delete(tk);
      } catch (e) {
        log.error({ ...serializeError(e) }, "Photo preparation failed");
        await ctx
          .reply("Failed to process the image. Please try again or send text instead.", {
            reply_to_message_id: ctx.message.message_id,
          })
          .catch(() => {});
      }
    });
  });

  async function processMediaGroup(
    tenant: ReturnType<typeof tenantFromGrammy>,
    ctxs: GrammyContext[]
  ): Promise<void> {
    const tk = threadKey(tenant);
    const captionCtx = ctxs.find((c) => (c.message?.caption ?? "").trim().length > 0);
    const captionRaw = captionCtx?.message?.caption?.trim() ?? "";
    const imageMatch = captionRaw.match(IMAGE_CMD_RE);

    const photoUrls = await downloadPhotos(ctxs);
    if (photoUrls.length === 0) {
      log.warn({ chatId: tenant.chatId }, "Media group had no downloadable photos");
      return;
    }

    // --- /image with album → editing using ALL album photos as references ---
    if (imageMatch) {
      const prompt = imageMatch[1].trim();
      if (!prompt) {
        await (captionCtx ?? ctxs[0]).reply(
          "Provide a description after /image, e.g. /image make it cartoon",
          { reply_to_message_id: ctxs[0].message?.message_id }
        );
        return;
      }
      await runImageEditCommand(captionCtx ?? ctxs[0], tenant, prompt, photoUrls);
      return;
    }

    // --- Vision analysis: feed all photos to the model at once ---
    if (!isDirectedAtBot(captionCtx ?? ctxs[0])) return;
    if (deps.llm.supportsImages() === false) {
      await (captionCtx ?? ctxs[0]).reply(
        "The current model does not support image input. Send text or switch to a vision-capable model.",
        { reply_to_message_id: ctxs[0].message?.message_id }
      );
      return;
    }

    // Also collect reference images from replied-to message for the generate_image tool.
    const replyRefs = captionCtx ? await collectReferenceImages(captionCtx) : [];
    const allRefs = [...replyRefs, ...photoUrls];
    if (allRefs.length > 0) threadReferenceImages.set(tk, allRefs);

    enqueue(tk, async () => {
      try {
        const tag = senderTag(captionCtx ?? ctxs[0]);
        const contentParts: { type: string; text?: string; image_url?: string }[] = [];
        const textPart = `${replyContext(captionCtx ?? ctxs[0])}${replyImageContextNote(captionCtx ?? ctxs[0])}${tag}${captionRaw || `Please analyze these ${photoUrls.length} images.`}`;
        if (textPart) contentParts.push({ type: "input_text", text: textPart });
        else if (tag) contentParts.push({ type: "input_text", text: tag.trim() });
        for (const url of photoUrls) {
          contentParts.push({ type: "input_image", image_url: url });
        }

        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content: contentParts as never,
        };
        await runLlmReply(
          captionCtx ?? ctxs[0],
          tenant,
          userItem,
          textPart,
          "photo"
        );
        threadReferenceImages.delete(tk);
      } catch (e) {
        log.error({ ...serializeError(e) }, "Media group preparation failed");
        await (captionCtx ?? ctxs[0])
          .reply("Failed to process the images. Please try again or send text instead.", {
            reply_to_message_id: ctxs[0].message?.message_id,
          })
          .catch(() => {});
      }
    });
  }

  async function runImageEditCommand(
    ctx: GrammyContext,
    tenant: ReturnType<typeof tenantFromGrammy>,
    prompt: string,
    explicitPhotoUrls?: string[]
  ): Promise<void> {
    const t0 = Date.now();
    log.info({ chatId: tenant.chatId, userId: tenant.userId }, "Image editing");

    const actionInterval = setInterval(() => {
      ctx.api.sendChatAction(tenant.chatId, "upload_photo").catch(() => {});
    }, 4000);

    try {
      await ctx.api.sendChatAction(tenant.chatId, "upload_photo");
      let photoUrls: string[] | undefined = explicitPhotoUrls;
      if (!photoUrls) {
        const file = await ctx.api.getFile(ctx.message!.photo!.pop()!.file_id);
        const photoUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        photoUrls = [await toDataUrl(photoUrl)];
      }
      const buffer = await deps.llm.generateImage(prompt, photoUrls);

      if (!buffer) {
        await ctx.reply("No image was generated. Try a different prompt.", {
          reply_to_message_id: ctx.message!.message_id,
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

      const sent = await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
        reply_to_message_id: ctx.message!.message_id,
        reply_markup: imageKeyboard(),
      });
      imageControls.set(imageControlKey(tenant.chatId, sent.message_id), {
        prompt,
        imageUrl: photoUrls[0],
      });
      storeConversation(
        tenant,
        "assistant",
        {
          kind: "image_edited",
          prompt,
          references: photoUrls.length,
          messageId: sent.message_id,
        },
        `edited image with prompt: ${prompt.slice(0, 200)} (refs=${photoUrls.length}, message_id ${sent.message_id})`
      );
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
      storeConversation(
        tenant,
        "assistant",
        { kind: "image_edit_failed", prompt, error: fmtError(e) },
        `image edit failed: ${fmtError(e)}`
      );
      await ctx
        .reply("Failed to edit the image. Please try again.", {
          reply_to_message_id: ctx.message!.message_id,
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
  }

  // --- Voice handler ---
  bot.on("message:voice", async (ctx) => {
    if (!deps.speech.isSttAvailable()) {
      await ctx.reply(
        "Voice recognition is not configured. Please ask the bot administrator to set up Yandex Cloud SpeechKit.",
        { reply_to_message_id: ctx.message.message_id }
      );
      return;
    }

    if (!isDirectedAtBot(ctx)) return;

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    enqueue(tk, async () => {
      try {
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
          await ctx.reply("Could not recognize speech. Please try again or send text.", {
            reply_to_message_id: ctx.message.message_id,
          });
          return;
        }

        log.info({ chatId: tenant.chatId, recognizedLen: recognized.length }, "STT recognized");

        const tag = senderTag(ctx);
        const content = `${replyContext(ctx)}${tag}${recognized}`;
        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content,
        };
        await runLlmReply(ctx, tenant, userItem, recognized, "voice", { voiceReply: true });
      } catch (e) {
        log.error({ ...serializeError(e) }, "Voice preparation failed");
        await ctx
          .reply("Failed to process the voice message. Please try again or send text.", {
            reply_to_message_id: ctx.message.message_id,
          })
          .catch(() => {});
      }
    });
  });

  // --- Text/code document handler ---
  bot.on("message:document", async (ctx) => {
    const captionRaw = ctx.message.caption?.trim() || "";
    if (!isDirectedAtBot(ctx)) return;

    const doc = ctx.message.document;
    const filename = doc.file_name ?? "document";
    const mime = doc.mime_type ?? "";
    const isTextDocument =
      SUPPORTED_TEXT_MIME_RE.test(mime) || SUPPORTED_TEXT_EXT_RE.test(filename);
    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);

    enqueue(tk, async () => {
      try {
        await ctx.api.sendChatAction(tenant.chatId, "upload_document");
        if (!isTextDocument) {
          await ctx.reply(
            `I can read text/code documents now, but this file looks like ${mime || "a binary file"}. Send a .txt/.md/.json/.csv/code file, or paste the relevant text.`,
            { reply_to_message_id: ctx.message.message_id }
          );
          return;
        }

        const { buffer } = await downloadTelegramFile(doc.file_id);
        const fileText = buffer.toString("utf8").replace(/\0/g, "").slice(0, 16000);
        if (!fileText.trim()) {
          await ctx.reply("I couldn't read text from this document.", {
            reply_to_message_id: ctx.message.message_id,
          });
          return;
        }

        const prompt = captionRaw || "Please analyze this document.";
        const tag = senderTag(ctx);
        const content = `${replyContext(ctx)}${tag}${prompt}\n\nAttached document: ${filename}\n\n${fileText}`;
        const userItem: ResponseInputItem = {
          type: "message",
          role: "user",
          content,
        };
        await runLlmReply(ctx, tenant, userItem, `${prompt}\n${filename}\n${fileText}`, "document");
      } catch (e) {
        log.error({ ...serializeError(e) }, "Document preparation failed");
        await ctx
          .reply("Failed to process the document. Please try again or paste the text.", {
            reply_to_message_id: ctx.message.message_id,
          })
          .catch(() => {});
      }
    });
  });

  // --- Audio file handler (best effort, SpeechKit currently expects OGG Opus) ---
  bot.on("message:audio", async (ctx) => {
    const captionRaw = ctx.message.caption?.trim() || "";
    if (!isDirectedAtBot(ctx)) return;

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    enqueue(tk, async () => {
      if (!deps.speech.isSttAvailable()) {
        await ctx.reply("Audio recognition is not configured.", {
          reply_to_message_id: ctx.message.message_id,
        });
        return;
      }
      try {
        await ctx.api.sendChatAction(tenant.chatId, "typing");
        const { buffer } = await downloadTelegramFile(ctx.message.audio.file_id);
        const recognized = await deps.speech.recognize(buffer);
        if (!recognized) {
          await ctx.reply(
            "I couldn't transcribe this audio file. Voice notes work best; other audio formats may need transcoding first.",
            { reply_to_message_id: ctx.message.message_id }
          );
          return;
        }
        const prompt = captionRaw || "Please answer based on this audio transcript.";
        const content = `${replyContext(ctx)}${senderTag(ctx)}${prompt}\n\nAudio transcript:\n${recognized}`;
        const userItem: ResponseInputItem = { type: "message", role: "user", content };
        await runLlmReply(ctx, tenant, userItem, `${prompt}\n${recognized}`, "audio");
      } catch (e) {
        log.error({ ...serializeError(e) }, "Audio preparation failed");
        await ctx.reply("Failed to process the audio file.", {
          reply_to_message_id: ctx.message.message_id,
        });
      }
    });
  });

  bot.on("message:video_note", async (ctx) => {
    if (!isDirectedAtBot(ctx)) return;

    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);
    enqueue(tk, async () => {
      if (!deps.speech.isSttAvailable()) {
        await ctx.reply("Video-note transcription is not configured.", {
          reply_to_message_id: ctx.message.message_id,
        });
        return;
      }
      try {
        await ctx.api.sendChatAction(tenant.chatId, "typing");
        const { buffer } = await downloadTelegramFile(ctx.message.video_note.file_id);
        const recognized = await deps.speech.recognize(buffer);
        if (!recognized) {
          await ctx.reply(
            "I received the video note, but couldn't extract speech from it without transcoding. Send it as a voice note for reliable transcription.",
            { reply_to_message_id: ctx.message.message_id }
          );
          return;
        }
        const content = `${replyContext(ctx)}${senderTag(ctx)}Video note transcript:\n${recognized}`;
        const userItem: ResponseInputItem = { type: "message", role: "user", content };
        await runLlmReply(ctx, tenant, userItem, recognized, "video_note");
      } catch (e) {
        log.error({ ...serializeError(e) }, "Video-note preparation failed");
        await ctx.reply("Failed to process the video note.", {
          reply_to_message_id: ctx.message.message_id,
        });
      }
    });
  });

  // --- Image control callbacks ---
  bot.callbackQuery(/^img:(var|prompt|square|wide)$/, async (ctx) => {
    const tenant = tenantFromGrammy(ctx);
    const messageId = ctx.callbackQuery.message?.message_id;
    if (!messageId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const key = imageControlKey(tenant.chatId, messageId);
    const control = imageControls.get(key);
    if (!control) {
      await ctx.answerCallbackQuery("Image controls expired");
      return;
    }

    const action = ctx.match[1];
    await ctx.answerCallbackQuery("Working on it");
    enqueue(threadKey(tenant), async () => {
      try {
        await ctx.api.sendChatAction(tenant.chatId, "upload_photo");
        if (action === "prompt") {
          const promptRes = await deps.llm.ask(
            "Improve the user's image prompt. Keep it concise, concrete, and directly usable. Output only the improved prompt.",
            control.prompt
          );
          await ctx.reply(promptRes.output_text || control.prompt, {
            reply_to_message_id: messageId,
          });
          return;
        }

        const nextPrompt =
          action === "var"
            ? `Create a polished variation of this image. Preserve the core subject and improve composition, lighting, and detail.\n\nOriginal prompt: ${control.prompt}`
            : action === "square"
              ? `${control.prompt}\n\nRender as a square 1:1 composition.`
              : `${control.prompt}\n\nRender as a wide 16:9 composition.`;
        let sourceImageUrl = control.imageUrl;
        const photo =
          ctx.callbackQuery.message && "photo" in ctx.callbackQuery.message
            ? ctx.callbackQuery.message.photo
            : undefined;
        if (!sourceImageUrl && photo?.length) {
          const file = await ctx.api.getFile(photo[photo.length - 1].file_id);
          const telegramUrl = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
          sourceImageUrl = await toDataUrl(telegramUrl);
        }
        const buffer = await deps.llm.generateImage(nextPrompt, sourceImageUrl ? [sourceImageUrl] : undefined);
        if (!buffer) {
          await ctx.reply("No image was generated. Try another variation.", {
            reply_to_message_id: messageId,
          });
          return;
        }
        const sent = await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
          reply_to_message_id: messageId,
          reply_markup: imageKeyboard(),
        });
        imageControls.set(imageControlKey(tenant.chatId, sent.message_id), {
          prompt: nextPrompt,
          imageUrl: sourceImageUrl,
        });
        storeConversation(
          tenant,
          "assistant",
          { kind: "image_variant", prompt: nextPrompt, messageId: sent.message_id },
          `image variant: ${nextPrompt.slice(0, 200)} (message_id ${sent.message_id})`
        );
      } catch (e) {
        log.error({ ...serializeError(e) }, "Image control failed");
        storeConversation(
          tenant,
          "assistant",
          { kind: "image_variant_failed", error: fmtError(e) },
          `image variant failed: ${fmtError(e)}`
        );
        await ctx.reply("Failed to generate this image variant.", {
          reply_to_message_id: messageId,
        });
      }
    });
  });
}

function uniqByCommand<T extends { command: string }>(v: T, i: number, arr: T[]): boolean {
  return arr.findIndex((x) => x.command === v.command) === i;
}

function imageControlKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`;
}

function imageKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Variation", "img:var")
    .text("Prompt+", "img:prompt")
    .row()
    .text("Square", "img:square")
    .text("Wide", "img:wide");
}

function replyParametersFor(ctx: GrammyContext): ReplyParameters | undefined {
  const messageId = ctx.message?.message_id;
  return messageId == null ? undefined : { message_id: messageId };
}

function shouldPreferChecklist(inputText: string, outputText: string): boolean {
  const wantsChecklist = /(чеклист|список дел|todo|to-do|tasks|checklist|план|шаги|steps)/i.test(
    inputText
  );
  return wantsChecklist && extractChecklist(outputText) != null;
}

function extractChecklist(text: string): InputChecklist | undefined {
  const lines = text.split("\n").map((line) => line.trim());
  const title =
    lines
      .find((line) => line.startsWith("#"))
      ?.replace(/^#+\s*/, "")
      .slice(0, 255) || "Checklist";

  const tasks = lines
    .map((line) => {
      const match = line.match(/^(?:[-*]\s+\[[ xX]\]\s+|[-*]\s+|\d+[.)]\s+)(.+)$/);
      return match?.[1].trim();
    })
    .filter((line): line is string => Boolean(line))
    .filter((line) => line.length >= 3 && line.length <= 100)
    .slice(0, 30)
    .map((line, index) => ({ id: index + 1, text: line }));

  if (tasks.length < 2) return undefined;
  return {
    title,
    tasks,
    others_can_add_tasks: true,
    others_can_mark_tasks_as_done: true,
  };
}
