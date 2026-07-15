import { InlineKeyboard, InputFile } from "grammy";
import type { McpDetailedTool } from "../mcp/service.js";
import type { TelegramCommand, ToolDefinition } from "../../core/module.js";
import { threadKey, type TenantContext } from "../../core/tenant.js";
import {
  ctxAudit,
  fmtError,
  sendRichReply,
  sendRichReplyChunked,
  serializeError,
} from "./helpers.js";
import {
  IMAGE_CONTROL_TTL_MS,
  imageControlKey,
  imageKeyboard,
  type ImageControl,
} from "./image-controls.js";
import type { TelegramDeps } from "./types.js";
import { log } from "../../utils/log.js";

type StoreConversation = (
  tenant: TenantContext,
  role: "user" | "assistant" | "tool",
  content: unknown,
  text: string,
  messageId?: number
) => void;

export interface CommandBuilderOptions {
  deps: TelegramDeps;
  chatEpochs: Map<number, number>;
  activeTurns: Map<string, AbortController>;
  imageControls: Map<string, ImageControl>;
  builtinTools: ToolDefinition[];
  storeConversation: StoreConversation;
}

/** Build commands owned by the Telegram transport; feature modules contribute their own. */
export function buildTelegramCommands(options: CommandBuilderOptions): TelegramCommand[] {
  const { deps, chatEpochs, activeTurns, imageControls, builtinTools, storeConversation } = options;

  return [
    {
      name: "stop",
      description: "Stop everything Skye is doing in this chat",
      public: true,
      handler: async (ctx, tenant) => {
        chatEpochs.set(tenant.chatId, (chatEpochs.get(tenant.chatId) ?? 0) + 1);
        for (const [key, controller] of activeTurns) {
          if (key === String(tenant.chatId) || key.startsWith(`${tenant.chatId}:`)) {
            controller.abort();
            activeTurns.delete(key);
          }
        }
        await ctx.reply("Stopped.", { reply_to_message_id: ctx.message?.message_id });
      },
    },
    {
      name: "start",
      description: "Say hi and get a few starting points",
      public: true,
      handler: async (ctx) => {
        const md = [
          "Hi, I'm Skye.",
          "",
          "Send whatever's on your mind.",
          "",
          "I'll help you work through it clearly.",
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
          "",
          "Legal: /terms · /privacy · /paysupport · /developer_info · /delete_my_data",
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
              inputText: prompt,
            });
            return;
          }

          const sent = await ctx.replyWithPhoto(new InputFile(buffer, "image.png"), {
            reply_to_message_id: ctx.message!.message_id,
            reply_markup: imageKeyboard(),
          });
          imageControls.set(imageControlKey(tenant.chatId, sent.message_id), {
            prompt,
            ownerUserId: tenant.userId!,
            expiresAt: Date.now() + IMAGE_CONTROL_TTL_MS,
          });
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
            inputText: prompt,
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
            inputText: prompt,
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
        const kb = new InlineKeyboard();
        if (ctx.chat?.type === "private") {
          kb.webApp("Open Settings", deps.webappUrl);
        }
        await ctx.reply("Open the settings panel to manage your subscription, model, and tools:", {
          reply_markup: kb,
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
          const servers: { name: string; scope: string; tools: McpDetailedTool[] }[] = [];
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
          const match = line.match(/^\[(.+?)\] (.+?)(?: \(replying to (.+?)\))?: (.+)$/);
          if (!match) return `| ${line.replace(/\|/g, "\\|")} |`;
          const [, time, sender, replyTo, rest] = match;
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
        const rows = reminders.map((reminder) => {
          const local = new Date(reminder.fireAt).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
          });
          const repeat = reminder.repeat !== "none" ? ` · ${reminder.repeat}` : "";
          return `| \`${reminder.id}\` | ${local}${repeat} | ${reminder.prompt
            .slice(0, 60)
            .replace(/\|/g, "\\|")} |`;
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
}

export function uniqByCommand<T extends { command: string }>(
  value: T,
  index: number,
  commands: T[]
): boolean {
  return commands.findIndex((command) => command.command === value.command) === index;
}

export function formatToolBlock(
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
