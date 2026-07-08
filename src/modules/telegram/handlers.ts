import {
  Bot,
  InlineKeyboard,
  InputFile,
  type Context as GrammyContext,
  type NextFunction,
} from "grammy";
import type { InputChecklist, Message, ReplyParameters } from "grammy/types";
import type { LlmClient, ResponseInputItem } from "../llm/client.js";
import type { McpService, McpDetailedTool } from "../mcp/service.js";
import type { MemoryService } from "../memory/service.js";
import type { ChatLogService } from "../chatLog/service.js";
import type { ChatConfigService } from "../chatConfig/service.js";
import type { UserConfigService } from "../userConfig/service.js";
import type { SpeechService } from "../speech/service.js";
import type { AuditService } from "../audit/service.js";
import type { SandboxService } from "../sandbox/service.js";
import type { ProactiveService } from "../proactive/service.js";
import type { RemindersService, Reminder } from "../reminders/service.js";
import type { ChannelService } from "../channel/service.js";
import type { EventBus } from "../../core/events.js";
import type { Contributions, TelegramCommand, ToolDefinition } from "../../core/module.js";
import { tenantFromGrammy, threadKey, type TenantContext } from "../../core/tenant.js";
import { checkAccess, type AccessDeps } from "./access.js";
import { runChatLoop } from "./chat.js";
import type { BillingService } from "../billing/service.js";
import type { AdminService } from "../admin/service.js";
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
  sendRichReplyChunked,
  serializeError,
  toDataUrl,
  toFileDataUrl,
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
  reminders?: RemindersService;
  channel?: ChannelService;
  events?: EventBus;
  billing: BillingService;
  admin: AdminService;
  botToken: string;
  webappUrl: string;
  defaultModelId: string;
  owner?: { name: string; tag: string };
}

const IMAGE_CMD_RE = /^\/image(?:@\S+)?\s*([\s\S]*)$/;
const TEXT_BURST_DELAY_MS = 1200;
const TEXT_HISTORY_LIMIT = 40;
const TRACKED_CHATS = new Set<number>();
const SUPPORTED_TEXT_MIME_RE =
  /^(text\/|application\/(json|xml|csv|javascript|x-javascript|typescript|x-typescript|sql))/i;
const SUPPORTED_TEXT_EXT_RE =
  /\.(txt|md|markdown|json|csv|ts|tsx|js|jsx|py|rb|go|rs|java|kt|swift|c|cc|cpp|h|hpp|css|html|xml|yaml|yml|toml|ini|sql|log)$/i;
const PDF_MIME = "application/pdf";
const PDF_EXT_RE = /\.pdf$/i;

/** Content part types used internally (Responses-API style, extended). */
type ContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "input_file"; file_data: string; filename: string };

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
    billing: deps.billing,
    admin: deps.admin,
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
    const reply =
      ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
    return reply?.from?.id === botUserId();
  }

  function isDirectedAtBot(ctx: GrammyContext): boolean {
    const isPM = ctx.chat?.type === "private";
    if (isPM) return true;
    return isMentioned(ctx) || isReplyToBot(ctx);
  }

  async function collectReferenceImages(ctx: GrammyContext): Promise<string[]> {
    const reply =
      ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
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

  /**
   * Collect media content parts (images, PDFs, audio transcripts) from the
   * replied-to message so the model can reason about them. This handles:
   * - Photos → input_image parts (if vision supported)
   * - PDF documents → input_file parts (if file parsing supported)
   * - Audio/voice → transcribed text (if STT available)
   * - Text documents → extracted text
   *
   * Returns an object with content parts (to merge into the user message) and
   * a textual summary (to include in the reply context).
   */
  async function collectReplyMedia(
    ctx: GrammyContext
  ): Promise<{ parts: ContentPart[]; summary: string }> {
    const reply =
      ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
    if (!reply) return { parts: [], summary: "" };

    const parts: ContentPart[] = [];
    const summaryParts: string[] = [];
    const supportsImages = deps.llm.supportsImages() !== false;
    const hasPdfEngine = !!deps.llm.settings.pdfEngine;
    const supportsFiles = supportsImages || hasPdfEngine;

    // Photo in replied message
    if (reply.photo?.length && supportsImages) {
      try {
        const file = await ctx.api.getFile(reply.photo[reply.photo.length - 1].file_id);
        const url = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
        const dataUrl = await toDataUrl(url);
        parts.push({ type: "input_image", image_url: dataUrl });
        const cap = "caption" in reply && reply.caption ? reply.caption : "photo";
        summaryParts.push(`[replied photo: ${cap}]`);
      } catch (e) {
        log.warn({ err: e }, "Failed to download replied photo");
      }
    }

    // Document (PDF or text) in replied message
    if (reply.document) {
      const doc = reply.document;
      const filename = doc.file_name ?? "document";
      const mime = doc.mime_type ?? "";
      const isPdf = mime === PDF_MIME || PDF_EXT_RE.test(filename);

      if (isPdf && supportsFiles) {
        try {
          const file = await ctx.api.getFile(doc.file_id);
          const url = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
          const dataUrl = await toFileDataUrl(url, PDF_MIME);
          parts.push({ type: "input_file", file_data: dataUrl, filename });
          summaryParts.push(`[replied PDF: ${filename}]`);
        } catch (e) {
          log.warn({ err: e }, "Failed to download replied PDF");
        }
      } else if (
        !isPdf &&
        (SUPPORTED_TEXT_MIME_RE.test(mime) || SUPPORTED_TEXT_EXT_RE.test(filename))
      ) {
        try {
          const { buffer } = await downloadTelegramFile(doc.file_id);
          const text = buffer.toString("utf8").replace(/\0/g, "").slice(0, 16000);
          if (text.trim()) {
            parts.push({ type: "input_text", text: `[Replied document: ${filename}]\n${text}` });
            summaryParts.push(`[replied document: ${filename}]`);
          }
        } catch (e) {
          log.warn({ err: e }, "Failed to download replied document");
        }
      } else if (!isPdf) {
        summaryParts.push(`[replied document: ${filename}]`);
      }
    }

    // Voice in replied message
    if (reply.voice && deps.speech.isSttAvailable()) {
      try {
        const { buffer } = await downloadTelegramFile(reply.voice.file_id);
        const transcript = await deps.speech.recognize(buffer);
        if (transcript) {
          parts.push({
            type: "input_text",
            text: `[Replied voice message transcript]\n${transcript}`,
          });
          summaryParts.push("[replied voice message]");
        }
      } catch (e) {
        log.warn({ err: e }, "Failed to transcribe replied voice");
      }
    }

    // Audio file in replied message
    if (reply.audio && deps.speech.isSttAvailable()) {
      try {
        const { buffer } = await downloadTelegramFile(reply.audio.file_id);
        const transcript = await deps.speech.recognize(buffer);
        if (transcript) {
          parts.push({ type: "input_text", text: `[Replied audio transcript]\n${transcript}` });
          summaryParts.push(
            `[replied audio: ${reply.audio.title ?? reply.audio.file_name ?? "audio"}]`
          );
        }
      } catch (e) {
        log.warn({ err: e }, "Failed to transcribe replied audio");
      }
    }

    return { parts, summary: summaryParts.join(" ") };
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

        const sent = await bot.api.sendPhoto(tenant.chatId, new InputFile(buffer, "image.png"), {
          ...(tenant.threadId != null ? { message_thread_id: tenant.threadId } : {}),
          reply_markup: imageKeyboard(),
        });
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

    void (async () => {
      const decision = await proactive.maybeReact(chatId, triggerMessageId, chatTitle);
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
            ...(tenant.threadId != null ? { message_thread_id: tenant.threadId } : {}),
          });
          storeConversation(
            tenant,
            "assistant",
            { kind: "proactive_reply", text: decision.text, targetMessageId: targetId },
            `[proactive reply to msg ${targetId}] ${decision.text}`
          );
          log.info(
            {
              chatId,
              targetId,
              text: decision.text,
              reason: decision.reason,
              messageId: sent.message_id,
            },
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
    const supportsImages = deps.llm.supportsImages() !== false;
    const hasPdfEngine = !!deps.llm.settings.pdfEngine;
    const supportsFiles = supportsImages || hasPdfEngine;
    if (supportsImages && supportsFiles) return items;
    return items.map((item) => {
      const m = item as { type?: string; content?: unknown };
      if (m.type !== "message" || !Array.isArray(m.content)) return item;
      const parts = (m.content as { type: string }[]).filter((p) => {
        if (p.type === "input_image") return supportsImages;
        if (p.type === "input_file") return supportsFiles;
        return true;
      });
      if (parts.length === 0) {
        return {
          ...item,
          content: [{ type: "input_text", text: "[attachment]" }],
        } as ResponseInputItem;
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
      if (typeof c === "object" && c !== null && !Array.isArray(c) && c.type === "function_call") {
        items.push(c as ResponseInputItem);
        continue;
      }
      // Normalize content for the chat API:
      // - string content → use as-is
      // - array content (Responses API parts) → use as-is (sanitizeHistory will strip images)
      // - object content (our metadata records like image edits, proactive replies)
      //   → fall back to row.text so the provider gets a plain string, not a map
      const content = typeof c === "string" || Array.isArray(c) ? c : row.text;
      items.push({
        type: "message",
        role: row.role === "assistant" ? "assistant" : "user",
        content,
      } as ResponseInputItem);
    }
    return sanitizeHistory(items);
  };

  const formatGroupMessage = (m: {
    sender: string;
    timestamp: string;
    type: string;
    content: string;
    replyTo?: string;
  }): string => {
    const reply = m.replyTo ? ` (replying to ${m.replyTo})` : "";
    const typeTag = m.type !== "text" ? `[${m.type}] ` : "";
    return `[${m.timestamp}] ${m.sender}${reply}: ${typeTag}${m.content}`;
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
        : "") ||
      ("audio" in reply && reply.audio
        ? `[audio: ${reply.audio.title ?? reply.audio.file_name ?? "file"}]`
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
      name: "start",
      description: "Say hi and get a few starting points",
      public: true,
      handler: async (ctx) => {
        const md = [
          "Hi — I'm **Skye**.",
          "",
          "Calm, minimal, here to help. A few things you can try right now:",
          "",
          "- _“Remember that I prefer plain text over HTML in my reports.”_ — long-term memory",
          "- _“Run a quick Node script that prints the current weather in Lisbon.”_ — sandbox",
          "- _“Search the web for the latest release of grammy and summarize the changelog.”_ — web search via the sandbox",
          "- _“Draft a short, warm reply to a friend who’s asking for book recommendations.”_ — chat",
          "",
          "Send any of those, or just say hello. Use /help to see everything I can do.",
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "help",
      description: "Show what Skye can do",
      public: true,
      handler: async (ctx) => {
        const md = [
          "Skye can do things for you — calmly, without the noise.",
          "",
          "## Chat",
          "",
          "Send a message and I answer, streaming in real time. Calm and concise by design. In groups, type “skye” or “скай” anywhere in your message, or reply to one of mine.",
          "",
          "## Memory",
          "",
          "Tell me something worth remembering — _“remember my project uses pnpm”_ — and I’ll keep it for next time. Use /memories to view them or /forget to wipe memories for this chat.",
          "",
          "## Images",
          "",
          "Ask in plain words — _“draw a cat on the moon”_, _“make this photo look like a watercolor”_ (reply to a photo), or send a photo with a question and I’ll describe or analyze it. I’ll generate or edit when it fits.",
          "",
          "## Voice",
          "",
          "Send a voice note — I transcribe and answer. Toggle voice replies with /voice.",
          "",
          "## Documents, PDFs & audio",
          "",
          "Send `.txt`, `.md`, `.json`, `.csv`, code, or logs and I'll read them. Send a PDF and I'll parse it — text, images, tables, everything. Reply to anyone's PDF, photo, or audio message and ask me about it — I'll see the content and reason about it. Audio files and video notes are transcribed too.",
          "",
          "## Sandbox & web",
          "",
          "I have an isolated per-chat sandbox with internet access. Ask me to run code, fetch data from the web, install packages, or analyze files — _“search the web for X and summarize”_ works.",
          "",
          "## Reminders",
          "",
          "Ask me to remind you of something, or to follow up later. Use /reminders to see active ones.",
          "",
          "## MCP tools",
          "",
          "Connect external tools via the Model Context Protocol — databases, APIs, anything. I’ll use them when relevant. Use /tools to see everything I have available.",
          "",
          "## Group chats",
          "",
          "Add me to a group. I listen for “skye” / “скай” and replies, log recent messages, summarize older ones to stay aware of context, and offer /catchup for a quick recap.",
          "",
          "---",
          "",
          "Commands: /reset · /image · /voice · /memories · /forget · /status · /tools · /catchup · /reminders · /config",
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "reset",
      description: "Reset conversation context",
      public: true,
      handler: async (ctx, tenant) => {
        const tk = threadKey(tenant);
        deps.chatLog.clearConversation(tenant.chatId, tk);
        await sendRichReply(
          ctx,
          "🧹 **Context reset.**\n\n_Memories are still saved — use /forget to clear them._"
        );
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
      description: "Open the Skye settings panel",
      public: true,
      handler: async (ctx) => {
        await ctx.reply("Open the settings panel to manage your subscription, model, and tools:", {
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
        const billAcc = tenant.userId ? deps.billing.getAccount(tenant.userId) : undefined;
        const modelEntry = deps.llm.resolveModel(billAcc?.modelId ?? deps.defaultModelId);
        const mcpTools = tenant.userId ? deps.mcp.toolsFor(tenant.userId) : [];
        const vision = deps.llm.supportsImages();
        const memoryCount = deps.memory.list(tenant.chatId).length;
        const ctxCount = deps.chatLog.countConversation(tenant.chatId, threadKey(tenant));
        const proactiveOn = deps.proactive?.isEnabled() ?? false;
        const reminderCount = deps.reminders?.list(tenant.chatId).length ?? 0;

        const yes = "✅";
        const no = "❌";
        const warn = "⚠️";

        const md = [
          "## Skye status",
          "",
          "| | |",
          "|---|---|",
          `| **Chat** | ${tenant.chatType}${tenant.threadId ? ` · topic ${tenant.threadId}` : ""} |`,
          `| **Model** | \`${modelEntry.name}\` (${modelEntry.multiplier}×) |`,
          `| **Skye Plus** | ${
            billAcc && deps.billing.hasActiveSub(billAcc)
              ? yes + ` until ${new Date(billAcc.subExpiresAt * 1000).toLocaleDateString()}`
              : no
          } |`,
          `| **Tokens left** | ${
            billAcc && deps.billing.hasActiveSub(billAcc)
              ? deps.billing.effectiveRemaining(billAcc).toLocaleString("en-US")
              : "—"
          } |`,
          `| **Vision** | ${vision === true ? yes : vision === false ? no : warn + " unknown"} |`,
          `| **Voice input** | ${deps.speech.isSttAvailable() ? yes : no} |`,
          `| **Voice replies** | ${chatCfg.voiceMode ? yes : no} |`,
          `| **TTS** | ${deps.speech.isTtsAvailable() ? yes : no} |`,
          `| **Memories** | ${memoryCount} |`,
          `| **Context items** | ${ctxCount} |`,
          `| **MCP tools** | ${mcpTools.length} |`,
          `| **Sandbox** | ${deps.sandbox?.isEnabled() ? yes : no} |`,
          `| **Proactive** | ${proactiveOn ? yes : no} |`,
          `| **Reminders** | ${reminderCount} |`,
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "tools",
      description: "Show all available tools (full debug detail)",
      handler: async (ctx, tenant) => {
        const mcpTools = deps.mcp.detailedToolsFor(tenant.userId);
        const total = builtinTools.length + mcpTools.length;

        if (total === 0) {
          await sendRichReply(ctx, "_No tools available._");
          return;
        }

        const sep = "\n\n---\n\n";
        const blocks: string[] = [
          `## Tools (${total} total)\n\n**${builtinTools.length} built-in · ${mcpTools.length} MCP**`,
        ];

        if (builtinTools.length > 0) {
          builtinTools.forEach((tool, i) => {
            const heading = i === 0 ? "### Built-in\n\n" : "";
            blocks.push(
              `${heading}${formatToolBlock(tool.name, tool.description, tool.parameters)}`
            );
          });
        }

        if (mcpTools.length > 0) {
          const servers: {
            name: string;
            scope: string;
            tools: McpDetailedTool[];
          }[] = [];
          for (const tool of mcpTools) {
            let group = servers.find((s) => s.name === tool.serverName && s.scope === tool.scope);
            if (!group) {
              group = { name: tool.serverName, scope: tool.scope, tools: [] };
              servers.push(group);
            }
            group.tools.push(tool);
          }
          for (const server of servers) {
            server.tools.forEach((tool, j) => {
              const heading = j === 0 ? `### MCP · ${server.name} (${server.scope})\n\n` : "";
              blocks.push(
                `${heading}${formatToolBlock(
                  tool.name,
                  tool.description,
                  tool.parameters,
                  `mcp:${server.name}`
                )}`
              );
            });
          }
        }

        await sendRichReplyChunked(ctx, blocks.join(sep));
      },
    },
    {
      name: "catchup",
      description: "Show recent group context",
      public: true,
      handler: async (ctx, tenant) => {
        const context = deps.chatLog.context(tenant.chatId);
        if (!context) {
          await sendRichReply(ctx, "_No group context yet._");
          return;
        }
        const lines = context.recentLog.split("\n").filter(Boolean);
        const rows = lines.map((line) => {
          // [HH:MM] Sender (replying to X): [type] content
          const m = line.match(/^\[(.+?)\] (.+?)(?: \(replying to (.+?)\))?: (.+)$/);
          if (!m) return `| ${line.replace(/\|/g, "\\|")} |`;
          const [, time, sender, replyTo, rest] = m;
          const typeMatch = rest.match(/^\[(.+?)\]\s*(.*)$/);
          const typeTag = typeMatch ? typeMatch[1] : "";
          const content = (typeMatch ? typeMatch[2] : rest).replace(/\|/g, "\\|").slice(0, 80);
          const senderCol = replyTo ? `${sender} ↩ ${replyTo}` : sender;
          return `| ${time} | ${senderCol} | ${typeTag || "text"} | ${content} |`;
        });
        const md = [
          `## ${context.chatTitle} — catch-up`,
          "",
          "| Time | Sender | Type | Content |",
          "|---|---|---|---|",
          ...rows,
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "reminders",
      description: "Show active reminders in this chat",
      public: true,
      handler: async (ctx, tenant) => {
        if (!deps.reminders) {
          await sendRichReply(ctx, "_Reminders are not available._");
          return;
        }
        const reminders = deps.reminders.list(tenant.chatId);
        if (reminders.length === 0) {
          await sendRichReply(ctx, "_No active reminders in this chat._");
          return;
        }
        const rows = reminders.map((r) => {
          const local = new Date(r.fireAt).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          });
          const repeat = r.repeat !== "none" ? ` · ${r.repeat}` : "";
          return `| \`${r.id}\` | ${local}${repeat} | ${r.prompt.slice(0, 60).replace(/\|/g, "\\|")} |`;
        });
        const md = [
          `## Reminders (${reminders.length})`,
          "",
          "| ID | When | Prompt |",
          "|---|---|---|",
          ...rows,
        ].join("\n");
        await sendRichReply(ctx, md);
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

    // Payment & callback flows bypass the access gate — Telegram deliveries we
    // must always honor (pre-checkout ack, successful-payment crediting) or
    // handle ourselves (inline keyboard callbacks).
    if (ctx.preCheckoutQuery) return next();
    if (ctx.callbackQuery) return next();
    if (ctx.message && "successful_payment" in ctx.message && ctx.message.successful_payment) {
      return next();
    }
    // Channel posts have no human author and are only captured (no reply),
    // so the access gate doesn't apply. Contributed handlers store them.
    if (ctx.channelPost || ctx.editedChannelPost) return next();

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

    const decision = checkAccess(access, chatId, ctx.from?.id);
    if (!decision.ok) {
      const directed = isDirectedAtBot(ctx);
      if (directed) await ctx.reply(decision.message);
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

      // Collect media content parts from the replied-to message (photos,
      // PDFs, audio transcripts) so the model can reason about them even
      // if they were sent by a different user in the chat.
      const replyMedia = await collectReplyMedia(ctx);
      if (replyMedia.parts.length > 0) {
        const content = (userItem as { content?: unknown }).content;
        if (typeof content === "string") {
          // Upgrade string content to a content-parts array with the text + media
          const parts: ContentPart[] = [];
          if (content) parts.push({ type: "input_text", text: content });
          parts.push(...replyMedia.parts);
          (userItem as { content: unknown }).content = parts;
        } else if (Array.isArray(content)) {
          // Merge reply media parts into the existing content array
          (content as ContentPart[]).push(...replyMedia.parts);
        }
      }

      // Persist the user message BEFORE calling the LLM so it survives
      // crashes, timeouts, and failed tool calls.
      storeConversation(
        tenant,
        "user",
        (userItem as { content?: unknown }).content ?? "",
        inputText,
        ctx.message?.message_id
      );

      // Resolve the user's selected model + token quota for this turn.
      const billAcc = tenant.userId ? deps.billing.getAccount(tenant.userId) : undefined;
      const modelId = billAcc?.modelId ?? deps.defaultModelId;
      const modelEntry = deps.llm.resolveModel(modelId);
      // The user message was already persisted to chatLog above, so historyFor
      // already includes it. Do not append userItem again.
      const inputItems: ResponseInputItem[] = historyFor(tenant).slice(-20);
      const tk = threadKey(tenant);
      const hasReferenceImages = threadReferenceImages.has(tk);

      // Quota pre-check: subscribers with zero tokens can't proceed.
      if (billAcc && deps.billing.hasActiveSub(billAcc)) {
        if (deps.billing.effectiveRemaining(billAcc) <= 0) {
          await draft.delete();
          await ctx.reply(
            "You're out of tokens for this month. Use /plus to buy a token pack, or wait for your renewal date.",
            { reply_to_message_id: ctx.message?.message_id }
          );
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
      }

      const meterUsage = (usage: { promptTokens: number; completionTokens: number }) => {
        if (!tenant.userId) return;
        const r = deps.billing.charge(
          tenant.userId,
          usage.promptTokens,
          usage.completionTokens,
          modelEntry.multiplier
        );
        if (!r.ok && r.reason === "no_subscription") {
          // shouldn't happen (gate caught it) but be defensive
          log.warn({ userId: tenant.userId }, "usage charge skipped: no subscription");
        }
      };

      const text = cleanMd(
        await runChatLoop(
          {
            llm: deps.llm,
            mcp: deps.mcp,
            memory: deps.memory,
            chatLog: deps.chatLog,
            userConfig: deps.userConfig,
            sandbox: deps.sandbox,
            reminders: deps.reminders,
            channel: deps.channel,
            builtinTools,
            hasReferenceImages,
            modelId,
            onUsage: meterUsage,
            owner: deps.owner,
          },
          tenant,
          inputItems,
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
    const mediaGroupId = (ctx.message as Message & { media_group_id?: string }).media_group_id;

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
        await runLlmReply(captionCtx ?? ctxs[0], tenant, userItem, textPart, "photo");
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
        "Voice recognition is not configured. Please ask the bot administrator to set up a speech provider (Yandex SpeechKit or OpenRouter).",
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
    const isPdf = mime === PDF_MIME || PDF_EXT_RE.test(filename);
    const tenant = tenantFromGrammy(ctx);
    const tk = threadKey(tenant);

    enqueue(tk, async () => {
      try {
        await ctx.api.sendChatAction(tenant.chatId, "upload_document");

        // --- PDF: send as file content part to the LLM ---
        if (isPdf) {
          const supportsFiles =
            deps.llm.supportsImages() !== false || !!deps.llm.settings.pdfEngine;
          if (!supportsFiles) {
            await ctx.reply(
              "The current model/provider does not support PDF file input. Try switching to a vision-capable model or configuring a PDF parsing engine.",
              { reply_to_message_id: ctx.message.message_id }
            );
            return;
          }

          const file = await ctx.api.getFile(doc.file_id);
          const url = `https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`;
          const dataUrl = await toFileDataUrl(url, PDF_MIME);

          const tag = senderTag(ctx);
          const prompt = captionRaw || "Please analyze this PDF document.";
          const contentParts: ContentPart[] = [
            { type: "input_text", text: `${replyContext(ctx)}${tag}${prompt}` },
            { type: "input_file", file_data: dataUrl, filename },
          ];

          const userItem: ResponseInputItem = {
            type: "message",
            role: "user",
            content: contentParts as never,
          };
          await runLlmReply(ctx, tenant, userItem, `${prompt}\n${filename}`, "document");
          return;
        }

        // --- Text/code documents ---
        if (!isTextDocument) {
          await ctx.reply(
            `I can read text/code documents and PDFs, but this file looks like ${mime || "a binary file"}. Send a .txt/.md/.json/.csv/code file or a PDF.`,
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

  // --- Audio file handler (best effort; provider may transcode via ffmpeg) ---
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
        const buffer = await deps.llm.generateImage(
          nextPrompt,
          sourceImageUrl ? [sourceImageUrl] : undefined
        );
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

  // --- Reminder firing ---
  // The reminder scheduler emits "reminders.fired" via EventBus. Here we
  // turn it into a full agent cycle: build a system-injected user message
  // with the reminder prompt + chat context, run the LLM loop, and send
  // the response to the chat — exactly as if a user had spoken.
  if (deps.events && deps.reminders) {
    deps.events.on("reminders.fired", (payload: { reminder: Reminder }) => {
      const { reminder } = payload;
      const tk =
        reminder.threadId != null
          ? `${reminder.chatId}:${reminder.threadId}`
          : String(reminder.chatId);

      enqueue(tk, async () => {
        log.info({ id: reminder.id, chatId: reminder.chatId }, "Processing fired reminder");

        const tenant: TenantContext = {
          chatId: reminder.chatId,
          chatType: "private",
          ...(reminder.threadId != null ? { threadId: reminder.threadId } : {}),
          ...(reminder.userId != null ? { userId: reminder.userId } : {}),
        };

        // Build context: for repeating reminders, include all group messages
        // since the previous fire time. For one-time reminders, use the last
        // 24 hours. This ensures digest-type reminders see the full window.
        const now = new Date();
        let since: Date;
        if (reminder.repeat === "hourly") {
          since = new Date(now.getTime() - 60 * 60 * 1000);
        } else if (reminder.repeat === "daily") {
          since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        } else if (reminder.repeat === "weekly") {
          since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (reminder.repeat === "monthly") {
          since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        } else {
          // one-time: last 24h of context
          since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }

        const periodMessages = deps.chatLog.groupMessagesSince(reminder.chatId, since, now);
        const recentContext = deps.chatLog.context(reminder.chatId);

        let contextBlock: string;
        if (periodMessages.length > 0) {
          const msgLines = periodMessages.map(formatGroupMessage).join("\n");
          const periodLabel =
            reminder.repeat === "hourly"
              ? "last hour"
              : reminder.repeat === "daily"
                ? "last 24 hours"
                : reminder.repeat === "weekly"
                  ? "last week"
                  : reminder.repeat === "monthly"
                    ? "last month"
                    : "last 24 hours";
          contextBlock = `Messages in this chat during the ${periodLabel} (${periodMessages.length} messages):\n${msgLines}`;
        } else if (recentContext) {
          contextBlock = `No messages in the relevant period. Recent activity:\n${recentContext.recentLog}`;
        } else {
          contextBlock = "(no recent activity in this chat)";
        }

        const reminderText = `[System: A reminder you set has just fired]\n\nReminder prompt: ${reminder.prompt}\n\n${contextBlock}\n\nAct on the reminder now. If it's a reminder to tell the user something, tell them. If it's a task, do it. Be natural and concise.`;

        storeConversation(
          tenant as unknown as ReturnType<typeof tenantFromGrammy>,
          "user",
          reminderText,
          `[reminder fired: ${reminder.id}] ${reminder.prompt.slice(0, 200)}`
        );

        const reminderAcc = reminder.userId ? deps.billing.getAccount(reminder.userId) : undefined;
        const reminderModelId = reminderAcc?.modelId ?? deps.defaultModelId;
        const reminderModel = deps.llm.resolveModel(reminderModelId);
        const reminderMeter = (usage: { promptTokens: number; completionTokens: number }) => {
          if (!reminder.userId) return;
          deps.billing.charge(
            reminder.userId,
            usage.promptTokens,
            usage.completionTokens,
            reminderModel.multiplier
          );
        };
        // The reminder prompt was already persisted to chatLog above, so
        // historyFor already includes it. Do not append userItem again.
        const inputItems: ResponseInputItem[] = historyFor(
          tenant as unknown as ReturnType<typeof tenantFromGrammy>
        ).slice(-20);

        const actionTicker = {
          timer: undefined as NodeJS.Timeout | undefined,
          start: () => {
            void bot.api.sendChatAction(reminder.chatId, "typing").catch(() => {});
            actionTicker.timer = setInterval(() => {
              void bot.api.sendChatAction(reminder.chatId, "typing").catch(() => {});
            }, 4000);
          },
          stop: () => {
            if (actionTicker.timer) clearInterval(actionTicker.timer);
            actionTicker.timer = undefined;
          },
        };

        actionTicker.start();
        try {
          const text = cleanMd(
            await runChatLoop(
              {
                llm: deps.llm,
                mcp: deps.mcp,
                memory: deps.memory,
                chatLog: deps.chatLog,
                userConfig: deps.userConfig,
                sandbox: deps.sandbox,
                reminders: deps.reminders,
                channel: deps.channel,
                builtinTools,
                modelId: reminderModelId,
                onUsage: reminderMeter,
                owner: deps.owner,
              },
              tenant,
              inputItems
            )
          );

          if (!text) {
            log.warn({ id: reminder.id }, "Reminder produced no response");
            return;
          }

          await bot.api.sendMessage(reminder.chatId, text, {
            parse_mode: "Markdown",
            ...(reminder.threadId != null ? { message_thread_id: reminder.threadId } : {}),
          });

          storeConversation(
            tenant as unknown as ReturnType<typeof tenantFromGrammy>,
            "assistant",
            { kind: "reminder_reply", reminderId: reminder.id },
            `[reminder reply] ${text.slice(0, 200)}`
          );

          log.info({ id: reminder.id, chatId: reminder.chatId }, "Reminder processed");
        } catch (e) {
          log.error(
            { ...serializeError(e), reminderId: reminder.id },
            "Reminder processing failed"
          );
        } finally {
          actionTicker.stop();
        }
      });
    });
  }
}

function uniqByCommand<T extends { command: string }>(v: T, i: number, arr: T[]): boolean {
  return arr.findIndex((x) => x.command === v.command) === i;
}

function formatToolBlock(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  source?: string
): string {
  const sourceTag = source ? ` \`${source}\`` : "";
  const desc = description || "_No description_";
  const params = JSON.stringify(parameters, null, 2);
  return [`**${name}**${sourceTag}`, "", desc, "", "Parameters:", "```json", params, "```"].join(
    "\n"
  );
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
