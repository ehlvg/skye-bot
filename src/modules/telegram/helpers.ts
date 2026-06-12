import type { Context as GrammyContext } from "grammy";
import type { Message } from "grammy/types";
import type { LogEntry } from "../chatLog/service.js";
import type { AuditEntry } from "../audit/service.js";
import { log } from "../../utils/log.js";

const MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

/** Download an image from a URL and return it as a base64 data URL. */
export async function toDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase() || "";
  const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim();
  const mime =
    MIME_MAP[ext] || (headerMime.startsWith("image/") ? headerMime : null) || "image/jpeg";

  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Parse a JSON string that may contain trailing garbage (some models append
 * extra text after the JSON object). Falls back to a brace-balanced scan.
 */
export function safeJsonParse(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    let depth = 0;
    let start = -1;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && start !== -1) {
          const candidate = trimmed.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            // keep searching
          }
        }
      }
    }
    log.warn({ raw: trimmed.slice(0, 200) }, "Failed to parse tool arguments JSON");
    return {};
  }
}

export function senderTag(ctx: GrammyContext): string {
  const from = ctx.from;
  if (!from) return "";
  const parts: string[] = [];
  if (from.first_name) parts.push(from.first_name);
  if (from.last_name) parts.push(from.last_name);
  const name = parts.join(" ") || "Unknown";
  const handle = from.username ? ` (@${from.username})` : "";
  return `[${name}${handle}] `;
}

export function ctxAudit(
  ctx: GrammyContext
): Pick<AuditEntry, "chatId" | "chatType" | "threadId" | "userId" | "username" | "firstName"> {
  return {
    chatId: ctx.chat!.id,
    chatType: ctx.chat!.type,
    threadId: ctx.message?.message_thread_id ?? undefined,
    userId: ctx.from!.id,
    username: ctx.from?.username ?? undefined,
    firstName: ctx.from?.first_name ?? undefined,
  };
}

export function serializeError(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { message: String(e) };
  const a = e as { status?: number; error?: unknown; code?: string };
  const obj: Record<string, unknown> = { message: e.message };
  if (a.status != null) obj.status = a.status;
  if (a.error != null) obj.apiError = a.error;
  if (a.code != null) obj.code = a.code;
  return obj;
}

export function fmtError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const a = e as {
    status?: number;
    error?: { code?: string; type?: string };
  };
  const parts: string[] = [e.message];
  if (a.status != null) parts.push(`status=${a.status}`);
  if (a.error?.code != null) parts.push(`code=${a.error.code}`);
  if (a.error?.type != null) parts.push(`type=${a.error.type}`);
  return parts.join(" | ");
}

export function extractLogEntry(ctx: GrammyContext): LogEntry {
  const from = ctx.from;
  const nameParts: string[] = [];
  if (from?.first_name) nameParts.push(from.first_name);
  if (from?.last_name) nameParts.push(from.last_name);
  const sender = nameParts.join(" ") || "Unknown";

  const now = new Date();
  const timestamp = now.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const msg = ctx.message!;
  let type = "text";
  let content = "";

  if ("text" in msg && msg.text) {
    content = msg.text;
  } else if ("sticker" in msg && msg.sticker) {
    type = "sticker";
    content = msg.sticker.emoji || "sticker";
  } else if ("photo" in msg && msg.photo) {
    type = "photo";
    content = ("caption" in msg && msg.caption) || "photo";
  } else if ("video" in msg && msg.video) {
    type = "video";
    content = ("caption" in msg && msg.caption) || "video";
  } else if ("animation" in msg && msg.animation) {
    type = "GIF";
    content = ("caption" in msg && msg.caption) || "GIF";
  } else if ("document" in msg && msg.document) {
    type = "document";
    content = msg.document.file_name || "document";
  } else if ("voice" in msg && msg.voice) {
    type = "voice";
    content = "voice message";
  } else if ("video_note" in msg && msg.video_note) {
    type = "video_note";
    content = "video note";
  } else if ("audio" in msg && msg.audio) {
    type = "audio";
    content = msg.audio.title || msg.audio.file_name || "audio";
  } else {
    content = "[unsupported message type]";
  }

  let replyTo: string | undefined;
  if ("reply_to_message" in msg && msg.reply_to_message?.from) {
    const rf = msg.reply_to_message.from;
    const rParts: string[] = [];
    if (rf.first_name) rParts.push(rf.first_name);
    if (rf.last_name) rParts.push(rf.last_name);
    replyTo = rParts.join(" ") || "Unknown";
  }

  return { sender, timestamp, type, content, replyTo };
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  isMcp: boolean;
}

export function formatToolCalls(calls: ToolCallRecord[]): string {
  return calls
    .map((c) => {
      const icon = c.isMcp ? "🔌" : "🧠";
      const argsStr = Object.entries(c.args)
        .map(([k, v]) => {
          let val = JSON.stringify(v);
          if (val.length > 40) val = val.slice(0, 40) + "...";
          return `${k}=${val}`;
        })
        .join(", ");
      return `${icon} ${c.name}(${argsStr})`;
    })
    .join("\n");
}

export function buildDraftMarkdown(toolCalls: ToolCallRecord[], suffix?: string): string {
  const prefix = formatToolCalls(toolCalls);
  const blockquote = prefix
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return suffix ? `${blockquote}\n\n${suffix}` : blockquote;
}

export function buildFinalReply(
  toolCalls: ToolCallRecord[],
  text: string
): string {
  if (toolCalls.length === 0) return text;
  return `${buildDraftMarkdown(toolCalls)}\n\n${text}`;
}

type ChatAction =
  | "typing"
  | "upload_photo"
  | "record_video"
  | "upload_video"
  | "record_voice"
  | "upload_voice"
  | "upload_document"
  | "choose_sticker"
  | "find_location"
  | "record_video_note"
  | "upload_video_note";

type RichRawApi = {
  sendRichMessage: (
    payload: {
      chat_id: number | string;
      message_thread_id?: number;
      rich_message: InputRichMessage;
      reply_parameters?: { message_id: number };
    },
    signal?: AbortSignal
  ) => Promise<Message>;
  sendRichMessageDraft: (
    payload: {
      chat_id: number;
      message_thread_id?: number;
      draft_id: number;
      rich_message: InputRichMessage;
    },
    signal?: AbortSignal
  ) => Promise<true>;
};

interface InputRichMessage {
  markdown?: string;
  html?: string;
  is_rtl?: boolean;
  skip_entity_detection?: boolean;
}

const THINKING_CUSTOM_EMOJI_ID = "5368324170671202286";
const DRAFT_MIN_INTERVAL_MS = 5000;
const FINAL_RETRY_LIMIT = 3;
const MAX_DRAFT_MARKDOWN_CHARS = 3500;
const RICH_DRAFT_PEER_INVALID = "TEXTDRAFT_PEER_INVALID";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(e: unknown): number | undefined {
  const retryAfter = (e as { parameters?: { retry_after?: unknown } })?.parameters?.retry_after;
  return typeof retryAfter === "number" ? retryAfter * 1000 : undefined;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function countSingleDollarDelimiters(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "$") continue;
    if (text[i - 1] === "\\" || text[i - 1] === "$" || text[i + 1] === "$") continue;
    count++;
  }
  return count;
}

export function stabilizeStreamingMarkdown(markdown: string): string {
  let stable = markdown.trim();
  if (stable.length > MAX_DRAFT_MARKDOWN_CHARS) {
    stable = `${stable.slice(0, MAX_DRAFT_MARKDOWN_CHARS).trimEnd()}\n\n...`;
  }

  if (countMatches(stable, /```/g) % 2 === 1) {
    stable += "\n```";
  }

  if (countMatches(stable, /\$\$/g) % 2 === 1) {
    stable += "\n$$";
  }

  if (countSingleDollarDelimiters(stable) % 2 === 1) {
    stable += "$";
  }

  return stable;
}

async function withTelegramRetry<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; context: string }
): Promise<T> {
  const attempts = options.attempts ?? FINAL_RETRY_LIMIT;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (e) {
      lastError = e;
      const waitMs = retryAfterMs(e);
      if (waitMs == null || attempt === attempts - 1) break;
      log.warn({ err: e, waitMs, context: options.context }, "Telegram rate limit, retrying");
      await sleep(waitMs + 500);
    }
  }

  throw lastError;
}

function richRaw(ctx: GrammyContext): RichRawApi {
  return ctx.api.raw as unknown as RichRawApi;
}

function threadId(ctx: GrammyContext): number | undefined {
  return ctx.message?.message_thread_id;
}

function replyParameters(ctx: GrammyContext): { message_id: number } | undefined {
  const id = ctx.message?.message_id;
  return id == null ? undefined : { message_id: id };
}

export async function sendRichReply(
  ctx: GrammyContext,
  markdown: string
): Promise<Message> {
  return withTelegramRetry(
    () =>
      richRaw(ctx).sendRichMessage({
        chat_id: ctx.chat!.id,
        message_thread_id: threadId(ctx),
        rich_message: { markdown },
        reply_parameters: replyParameters(ctx),
      }),
    { context: "sendRichMessage" }
  );
}

async function sendRichDraft(ctx: GrammyContext, draftId: number, markdown: string): Promise<true> {
  return withTelegramRetry(
    () =>
      richRaw(ctx).sendRichMessageDraft({
        chat_id: ctx.chat!.id,
        message_thread_id: threadId(ctx),
        draft_id: draftId,
        rich_message: { markdown },
      }),
    { attempts: 1, context: "sendRichMessageDraft" }
  );
}

function telegramDescription(e: unknown): string {
  return String((e as { description?: unknown })?.description ?? "");
}

function isPermanentDraftError(e: unknown): boolean {
  const description = telegramDescription(e);
  return description.includes(RICH_DRAFT_PEER_INVALID) || retryAfterMs(e) == null;
}

export function createChatActionTicker(ctx: GrammyContext, action: ChatAction, intervalMs = 4000) {
  let timer: NodeJS.Timeout | undefined;
  const send = () => ctx.api.sendChatAction(ctx.chat!.id, action).catch(() => {});

  return {
    start: () => {
      send();
      timer = setInterval(send, intervalMs);
    },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}

export function createDraftManager(ctx: GrammyContext) {
  const draftId = ctx.update.update_id || ctx.message?.message_id || Date.now();
  let enabled = ctx.chat?.type === "private";
  let lastText = "";
  let pendingText: string | undefined;
  let sending = false;
  let stopped = false;
  let nextAllowedAt = 0;
  let idleWaiters: Array<() => void> = [];

  const thinkingPrefix = `<tg-thinking><tg-emoji emoji-id="${THINKING_CUSTOM_EMOJI_ID}">💭</tg-emoji> Thinking...</tg-thinking>`;
  const buildThinkingDraft = (markdown: string) =>
    `${thinkingPrefix}\n\n${stabilizeStreamingMarkdown(markdown)}`.trim();

  const notifyIdle = () => {
    if (sending || pendingText != null) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  const pump = async () => {
    if (sending) return;
    sending = true;

    try {
      while (!stopped && pendingText != null) {
        const text = pendingText;
        pendingText = undefined;

        if (!enabled) {
          lastText = text;
          continue;
        }

        const waitMs = nextAllowedAt - Date.now();
        if (waitMs > 0) await sleep(waitMs);

        try {
          await sendRichDraft(ctx, draftId, buildThinkingDraft(text));
          lastText = text;
          nextAllowedAt = Date.now() + DRAFT_MIN_INTERVAL_MS;
        } catch (e) {
          const waitMsFromError = retryAfterMs(e);
          if (waitMsFromError != null) {
            nextAllowedAt = Date.now() + waitMsFromError + 500;
            pendingText = text;
            log.warn({ err: e, waitMs: waitMsFromError }, "Rich draft rate limited");
            continue;
          }
          if (isPermanentDraftError(e)) {
            enabled = false;
            lastText = text;
            log.debug({ err: e }, "Rich drafts disabled for this peer");
            continue;
          }
          log.warn({ err: e }, "sendRichMessageDraft failed");
        }
      }
    } finally {
      sending = false;
      if (!stopped && pendingText != null) {
        void pump();
      } else {
        notifyIdle();
      }
    }
  };

  return {
    send: (text: string) => {
      if (stopped || !enabled || text === lastText || text === pendingText) return;
      pendingText = text;
      void pump();
    },
    flush: async () => {
      if (!sending && pendingText == null) return;
      await new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    delete: async () => {
      stopped = true;
      pendingText = undefined;
      if (sending) {
        await new Promise<void>((resolve) => idleWaiters.push(resolve));
      }
      notifyIdle();
    },
  };
}
