import { Bot, InputFile, Context, NextFunction } from "grammy";
import { BOT_TOKEN, ALLOWED_IDS, BASE_URL } from "./config.js";
import { cleanMd } from "./utils/markdown.js";
import {
  askSkyeStream,
  checkModelCapabilities,
  generateImage,
  modelSupportsImages,
  ApiCredentials,
} from "./openai.js";
import { log } from "./utils/log.js";
import { buildContext } from "./contextBuilder.js";
import { buildSystemMessage } from "./prompt.js";
import { clearMemories } from "./memory.js";
import { getChatConfig } from "./chatConfig.js";
import { registerConfigHandlers, handleWizardInput, isInWizard } from "./configCommand.js";
import { logMessage, summarizeChat, type LogEntry } from "./chatLog.js";
import { buildTools, executeTool, toolNotification } from "./tools.js";
import { initReminders } from "./reminders.js";

const bot = new Bot(BOT_TOKEN);

const OUR_COMMANDS = new Set(["image", "reset", "forget", "config"]);

/** Download an image from a URL and return it as a base64 data URL. */
async function toDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  const MIME_MAP: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
  };
  const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase() || "";
  const headerMime = (res.headers.get("content-type") || "").split(";")[0].trim();
  const mime =
    MIME_MAP[ext] || (headerMime.startsWith("image/") ? headerMime : null) || "image/jpeg";

  return `data:${mime};base64,${buf.toString("base64")}`;
}

// Global error handler
bot.catch((err) => {
  const msg = (err as any)?.error?.message || (err as Error).message || "Unknown error";
  log.err(`Bot error: ${msg}`);
});

// Advertise bot commands
void bot.api.setMyCommands([
  { command: "image", description: "Generate an image from a text prompt" },
  { command: "reset", description: "Reset conversation context" },
  { command: "forget", description: "Clear all saved memories for this chat" },
  { command: "config", description: "Configure API credentials for this chat" },
]);

// Composite key: "chatId" or "chatId:threadId" for per-thread state
function threadKey(chatId: number, threadId?: number): string {
  return threadId != null ? `${chatId}:${threadId}` : String(chatId);
}

// Rolling message history per thread
const memory = new Map<string, Array<any>>();

function storeMessage(key: string, msg: any) {
  if (!memory.has(key)) memory.set(key, []);
  const list = memory.get(key)!;
  list.push(msg);
  if (list.length > 15) list.shift();
}

// Last image data URL per thread (for edit_image tool)
const lastImages = new Map<string, string>();

/**
 * If the model doesn't support images, strip image_url parts from context.
 */
function sanitizeContext(messages: any[]): any[] {
  if (modelSupportsImages() !== false) return messages;
  return messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    const textParts = msg.content.filter((p: any) => p.type !== "image_url");
    if (textParts.length === 0) return { ...msg, content: "[image]" };
    if (textParts.length === 1 && textParts[0].text) return { ...msg, content: textParts[0].text };
    return { ...msg, content: textParts };
  });
}

// Rate limiting: 1 request per 2s per thread
const lastCall = new Map<string, number>();
function canRespond(key: string) {
  const now = Date.now();
  const prev = lastCall.get(key) ?? 0;
  if (now - prev < 2000) return false;
  lastCall.set(key, now);
  return true;
}

/** Build a sender tag like [First Last (@username)] from ctx.from */
function senderTag(ctx: Context): string {
  const from = ctx.from;
  if (!from) return "";
  const parts: string[] = [];
  if (from.first_name) parts.push(from.first_name);
  if (from.last_name) parts.push(from.last_name);
  const name = parts.join(" ") || "Unknown";
  const handle = from.username ? ` (@${from.username})` : "";
  return `[${name}${handle}] `;
}

/** Extract a LogEntry from any message context */
function extractLogEntry(ctx: Context): LogEntry {
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

// --- Access control helpers ---

function getCredentials(chatId: number): ApiCredentials | undefined {
  if (ALLOWED_IDS.has(chatId)) return undefined; // use global
  const cfg = getChatConfig(chatId);
  if (!cfg.apiKey) return undefined;
  return {
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl ?? BASE_URL,
  };
}

function hasAccess(chatId: number): boolean {
  if (ALLOWED_IDS.has(chatId)) return true;
  return !!getChatConfig(chatId).apiKey;
}

// --- Handler registration ---

// 1. Config handlers (always accessible)
registerConfigHandlers(bot);

// 2. Access gate middleware
async function accessGate(ctx: Context, next: NextFunction) {
  const chatId = ctx.chat?.id;
  if (!chatId) return next();

  if (ctx.callbackQuery?.data?.startsWith("cfg:")) return next();
  if (isInWizard(chatId)) return next();

  const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
  const botUsername = ctx.me?.username ?? "";
  const text = ctx.message?.text ?? ctx.message?.caption ?? "";

  const cmdMatch = text.match(/^\/(\w+)(?:@(\S+))?/);
  const isOurCommand = cmdMatch
    ? OUR_COMMANDS.has(cmdMatch[1]) && (!cmdMatch[2] || cmdMatch[2] === botUsername)
    : false;

  if (isGroup && cmdMatch && !isOurCommand) return;
  if (isOurCommand && cmdMatch![1] === "config") return next();

  if (!hasAccess(chatId)) {
    const isMention = botUsername ? text.includes(`@${botUsername}`) : false;
    const isDirected = !isGroup || isMention || isOurCommand;
    if (isDirected) {
      await ctx.reply("You need to provide an API key to use this bot. Use /config to set one up.");
    }
    return;
  }

  return next();
}

bot.use(accessGate);

// 2b. Chat logging middleware (groups only)
bot.on("message", async (ctx, next) => {
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    const entry = extractLogEntry(ctx);
    if (logMessage(ctx.chat.id, entry, ctx.chat.title)) {
      void summarizeChat(ctx.chat.id, getCredentials(ctx.chat.id));
    }
  }
  return next();
});

// 3. Main chat function

interface ChatOptions {
  chatId: number;
  threadId?: number;
  isGroup: boolean;
  groupTitle?: string;
  messages: any[];
  creds?: ApiCredentials;
  lastImageDataUrl?: string;
  /** Called on each content delta with the accumulated snapshot. */
  onChunk?: (snapshot: string) => void;
  /** Called before executing a tool call (for status notifications). */
  onToolCall?: (name: string, args: any) => Promise<void>;
  /** Called when a tool produces an image. */
  onImage?: (buffer: Buffer) => Promise<void>;
}

/**
 * Core agentic loop: streams a response and handles all tool calls.
 * Returns the final text, or empty string if the model produced only tool calls.
 */
async function chat(opts: ChatOptions): Promise<string> {
  const systemMsg = buildSystemMessage(
    opts.groupTitle ? { groupTitle: opts.groupTitle } : undefined
  );
  const tools = buildTools(opts.isGroup);
  const msgs: any[] = [systemMsg, ...opts.messages];

  const toolCtx = {
    chatId: opts.chatId,
    threadId: opts.threadId,
    creds: opts.creds,
    lastImageDataUrl: opts.lastImageDataUrl,
  };

  let iterations = 0;
  while (iterations <= 5) {
    const stream = askSkyeStream(msgs, tools, opts.creds);

    if (opts.onChunk) {
      stream.on("content", (_delta, snapshot) => opts.onChunk!(snapshot));
    }

    const completion = await stream.finalChatCompletion();
    const choice = completion.choices[0];

    if (!choice?.message?.tool_calls?.length) {
      return choice?.message?.content || "";
    }

    const toolNames = choice.message.tool_calls.map((tc: any) => tc.function?.name).join(", ");
    log.info(`chat() iteration ${iterations}: tool calls [${toolNames}]`);

    // Process tool calls
    msgs.push(choice.message);

    for (const tc of choice.message.tool_calls) {
      if (tc.type !== "function") continue;

      const name = tc.function.name;
      let args: any;
      try {
        args = JSON.parse(tc.function.arguments);
      } catch {
        args = {};
      }

      // Notify before executing
      if (opts.onToolCall) await opts.onToolCall(name, args);

      let result: { text: string; imageBuffer?: Buffer };
      try {
        result = await executeTool(name, args, toolCtx);
      } catch (e: any) {
        result = { text: `Tool error: ${e?.message || String(e)}` };
      }

      // Send image to user immediately if produced
      if (result.imageBuffer && opts.onImage) {
        await opts.onImage(result.imageBuffer).catch(() => {});
      }

      msgs.push({ role: "tool", tool_call_id: tc.id, content: result.text });
    }

    // After the first round of tool calls, nudge the model to respond with text
    if (iterations === 0) {
      msgs.push({
        role: "user",
        content: "[system: tool results delivered — now respond to the user with text]",
      });
    }

    iterations++;
  }

  log.warn(`chat() exhausted tool-call loop (${opts.chatId})`);
  throw new Error("Too many tool calls without a response.");
}

// 4. Commands

bot.command("reset", async (ctx) => {
  const tk = threadKey(ctx.chat.id, ctx.message?.message_thread_id);
  memory.delete(tk);
  await ctx.reply("Context reset. Memories are still saved — use /forget to clear them.");
});

// Direct image generation (bypasses the model for speed)
bot.command("image", async (ctx) => {
  const prompt = ctx.match?.trim();
  if (!prompt) {
    await ctx.reply("Provide a description after /image, e.g. /image a cat on the moon");
    return;
  }

  const tk = threadKey(ctx.chat.id, ctx.message?.message_thread_id);
  if (!canRespond(tk)) return;

  const creds = getCredentials(ctx.chat.id);

  void (async () => {
    log.info(`Image generation from ${ctx.chat.id}: ${prompt}`);

    const actionInterval = setInterval(() => {
      ctx.api.sendChatAction(ctx.chat.id, "upload_photo").catch(() => {});
    }, 4000);

    try {
      await ctx.api.sendChatAction(ctx.chat.id, "upload_photo");
      const buffer = await generateImage(prompt, undefined, creds);

      if (!buffer) {
        await ctx.reply("No image was generated. Try a different prompt.", {
          reply_to_message_id: ctx.message!.message_id,
        });
        return;
      }

      await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
        reply_to_message_id: ctx.message!.message_id,
      });
    } catch (e: any) {
      log.err(`Image generation failed: ${e?.message || e}`);
      await ctx
        .reply("Failed to generate the image. Please try again.", {
          reply_to_message_id: ctx.message!.message_id,
        })
        .catch(() => {});
    } finally {
      clearInterval(actionInterval);
    }
  })();
});

bot.command("forget", async (ctx) => {
  await clearMemories(ctx.chat.id);
  await ctx.reply("All memories cleared.");
});

// 5. Text messages

bot.on("message:text", async (ctx) => {
  if (await handleWizardInput(ctx)) return;

  const isPM = ctx.chat.type === "private";
  const mention = ctx.message.text.includes(`@${ctx.me.username}`);

  if (!isPM && !mention) return;

  const tk = threadKey(ctx.chat.id, ctx.message?.message_thread_id);
  if (!canRespond(tk)) return;

  void (async () => {
    log.info(`Incoming from ${ctx.chat.id}`);

    // React to show the message was received
    try {
      await ctx.react("👀");
    } catch {}

    const creds = getCredentials(ctx.chat.id);
    const tag = senderTag(ctx);
    const userMsg = {
      role: "user" as const,
      content: tag + ctx.message.text,
    };
    const history = memory.get(tk) || [];
    const context = sanitizeContext(buildContext([...history, userMsg]));

    const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";
    const groupTitle = isGroup ? (ctx.chat as any).title : undefined;

    // Throttled streaming draft
    let lastDraft = 0;
    const onChunk = (snapshot: string) => {
      const now = Date.now();
      if (now - lastDraft < 300) return;
      lastDraft = now;
      (ctx as any).replyWithDraft?.(snapshot)?.catch(() => {});
    };

    // Tool call notifications in DMs
    const onToolCall = async (name: string, args: any) => {
      const note = toolNotification(name, args);
      if (note && isPM) {
        await ctx.reply(`→ ${note}`, {
          reply_to_message_id: ctx.message.message_id,
        }).catch(() => {});
      }
    };

    // Send generated images
    let imagesSent = false;
    const onImage = async (buffer: Buffer) => {
      imagesSent = true;
      await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
        reply_to_message_id: ctx.message.message_id,
      });
    };

    try {
      const text = cleanMd(
        await chat({
          chatId: ctx.chat.id,
          threadId: ctx.message.message_thread_id,
          isGroup,
          groupTitle,
          messages: context,
          creds,
          lastImageDataUrl: lastImages.get(tk),
          onChunk,
          onToolCall,
          onImage,
        })
      );

      storeMessage(tk, userMsg);

      if (!text) {
        if (!imagesSent) {
          await ctx.reply("I couldn't generate a response. Please try again.", {
            reply_to_message_id: ctx.message.message_id,
          });
        }
        return;
      }

      storeMessage(tk, { role: "assistant", content: text });
      await ctx.reply(text, { reply_to_message_id: ctx.message.message_id });
    } catch (e: any) {
      log.err(`Text handler failed: ${e?.message || e}`);
      await ctx
        .reply("Something went wrong, please try again.", {
          reply_to_message_id: ctx.message.message_id,
        })
        .catch(() => {});
    }
  })();
});

// 6. Photo messages

const IMAGE_CMD_RE = /^\/image(?:@\S+)?\s*([\s\S]*)$/;

bot.on("message:photo", async (ctx) => {
  const isPM = ctx.chat.type === "private";
  const captionRaw = ctx.message.caption?.trim() || "";
  const imageMatch = captionRaw.match(IMAGE_CMD_RE);

  const tk = threadKey(ctx.chat.id, ctx.message?.message_thread_id);

  // Path 1: /image command with photo → direct image editing (no model overhead)
  if (imageMatch) {
    const prompt = imageMatch[1].trim();
    if (!prompt) {
      await ctx.reply("Provide a description after /image, e.g. /image make it cartoon", {
        reply_to_message_id: ctx.message.message_id,
      });
      return;
    }

    if (!canRespond(tk)) return;

    const creds = getCredentials(ctx.chat.id);

    void (async () => {
      log.info(`Image editing from ${ctx.chat.id}: ${prompt}`);

      const actionInterval = setInterval(() => {
        ctx.api.sendChatAction(ctx.chat.id, "upload_photo").catch(() => {});
      }, 4000);

      try {
        await ctx.api.sendChatAction(ctx.chat.id, "upload_photo");
        const file = await ctx.api.getFile(ctx.message.photo.pop()!.file_id);
        const photoUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        const dataUrl = await toDataUrl(photoUrl);
        const buffer = await generateImage(prompt, dataUrl, creds);

        if (!buffer) {
          await ctx.reply("No image was generated. Try a different prompt.", {
            reply_to_message_id: ctx.message.message_id,
          });
          return;
        }

        await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
          reply_to_message_id: ctx.message.message_id,
        });
      } catch (e: any) {
        log.err(`Image editing failed: ${e?.message || e}`);
        await ctx
          .reply("Failed to edit the image. Please try again.", {
            reply_to_message_id: ctx.message.message_id,
          })
          .catch(() => {});
      } finally {
        clearInterval(actionInterval);
      }
    })();
    return;
  }

  // Path 2: Vision analysis — treat photo as a regular message
  const hasMention = captionRaw.includes(`@${ctx.me.username}`);
  if (!isPM && (!captionRaw || !hasMention)) return;

  if (modelSupportsImages() === false) {
    await ctx.reply(
      "The current model does not support image input. Send text or switch to a vision-capable model.",
      { reply_to_message_id: ctx.message.message_id }
    );
    return;
  }

  if (!canRespond(tk)) return;

  void (async () => {
    log.info(`Photo from ${ctx.chat.id}`);

    try {
      await ctx.react("👀");
    } catch {}

    const creds = getCredentials(ctx.chat.id);
    const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";
    const groupTitle = isGroup ? (ctx.chat as any).title : undefined;

    let lastDraft = 0;
    const onChunk = (snapshot: string) => {
      const now = Date.now();
      if (now - lastDraft < 300) return;
      lastDraft = now;
      (ctx as any).replyWithDraft?.(snapshot)?.catch(() => {});
    };

    const onToolCall = async (name: string, args: any) => {
      const note = toolNotification(name, args);
      if (note && isPM) {
        await ctx.reply(`→ ${note}`, {
          reply_to_message_id: ctx.message.message_id,
        }).catch(() => {});
      }
    };

    let imagesSent = false;
    const onImage = async (buffer: Buffer) => {
      imagesSent = true;
      await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
        reply_to_message_id: ctx.message.message_id,
      });
    };

    try {
      const file = await ctx.api.getFile(ctx.message.photo.pop()!.file_id);
      const telegramUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
      const dataUrl = await toDataUrl(telegramUrl);

      // Store for potential edit_image tool use
      lastImages.set(tk, dataUrl);

      const tag = senderTag(ctx);
      const parts: any[] = [];
      if (captionRaw) parts.push({ type: "text", text: tag + captionRaw });
      else if (tag) parts.push({ type: "text", text: tag.trim() });
      parts.push({ type: "image_url", image_url: { url: dataUrl } });

      const userMsg = { role: "user" as const, content: parts };
      const history = memory.get(tk) || [];
      const context = buildContext([...history, userMsg]);

      const text = cleanMd(
        await chat({
          chatId: ctx.chat.id,
          threadId: ctx.message.message_thread_id,
          isGroup,
          groupTitle,
          messages: context,
          creds,
          lastImageDataUrl: dataUrl,
          onChunk,
          onToolCall,
          onImage,
        })
      );

      storeMessage(tk, userMsg);

      if (!text) {
        if (!imagesSent) {
          await ctx.reply("I couldn't generate a response. Please try again.", {
            reply_to_message_id: ctx.message.message_id,
          });
        }
        return;
      }

      storeMessage(tk, { role: "assistant", content: text });

      await ctx.reply(text, { reply_to_message_id: ctx.message.message_id });
    } catch (e: any) {
      log.err(`Image handler failed: ${e?.message || e}`);
      await ctx
        .reply("Failed to process the image. Please try again or send text instead.", {
          reply_to_message_id: ctx.message.message_id,
        })
        .catch(() => {});
    }
  })();
});

// Fetch model capabilities, init reminders, then start
checkModelCapabilities().finally(() => {
  initReminders(async (chatId, threadId, text) => {
    const options: any = {};
    if (threadId != null) options.message_thread_id = threadId;
    await bot.api.sendMessage(chatId, text, options);
  });

  bot.start({ drop_pending_updates: true });
  log.info("Skye is alive");
});
