import type { SkyeModule, ToolDefinition } from "../../core/module.js";
import { migrations } from "./migrations.js";
import { buildRoutes } from "./routes.js";
import { sendRichReply } from "../telegram/helpers.js";
import {
  addMemory,
  clearMemories,
  deleteMemory,
  getMemories,
  memoryService,
  type MemoryService,
} from "./service.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    memory: MemoryService;
  }
}

const memoryTools: ToolDefinition[] = [
  {
    name: "save_memory",
    description:
      "Save a piece of information to long-term memory for this chat. Use this when the user asks you to remember something, or when you encounter important facts worth preserving (names, preferences, project details, etc.).",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The information to remember, written as a clear factual statement.",
        },
      },
      required: ["content"],
    },
    execute: async (args, tenant) => {
      const content = String(args.content ?? "");
      const entry = await addMemory(tenant.chatId, content);
      return `Memory saved with ID ${entry.id}.`;
    },
  },
  {
    name: "delete_memory",
    description:
      "Delete a specific memory by its ID. Use this when the user asks you to forget something.",
    parameters: {
      type: "object",
      properties: {
        memory_id: {
          type: "string",
          description: "The ID of the memory to delete (e.g. mem_abc123).",
        },
      },
      required: ["memory_id"],
    },
    execute: async (args, tenant) => {
      const id = String(args.memory_id ?? "");
      const ok = await deleteMemory(tenant.chatId, id);
      return ok ? `Memory ${id} deleted.` : `Memory ${id} not found.`;
    },
  },
];

export const memoryModule: SkyeModule = {
  name: "memory",
  migrations,
  init(ctx) {
    ctx.services.set("memory", memoryService);
    return {
      service: memoryService,
      tools: memoryTools,
      panelRoutes: buildRoutes(ctx),
      commands: [
        {
          name: "memories",
          description: "Show saved memories for this chat",
          handler: async (ctx, tenant) => {
            const memories = getMemories(tenant.chatId);
            if (memories.length === 0) {
              await sendRichReply(ctx, "_No memories saved for this chat yet._");
              return;
            }
            const rows = memories.map((m) => {
              const local = new Date(m.createdAt).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              });
              const content = m.content.replace(/\|/g, "\\|").slice(0, 80);
              return `| \`${m.id}\` | ${local} | ${content} |`;
            });
            const md = [
              `## Memories (${memories.length})`,
              "",
              "| ID | Created | Content |",
              "|---|---|---|",
              ...rows,
              "",
              "_Use /forget to clear all memories._",
            ].join("\n");
            await sendRichReply(ctx, md);
          },
        },
        {
          name: "forget",
          description: "Clear all saved memories for this chat",
          handler: async (ctx, tenant) => {
            await clearMemories(tenant.chatId);
            await sendRichReply(ctx, "🧹 **All memories cleared.**");
          },
        },
      ],
    };
  },
};
