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
  searchMemories,
  updateMemory,
  memoryUpdatePatch,
  EMPTY_MEMORY_UPDATE_RESULT,
  MEMORY_CATEGORIES,
  type MemoryCategory,
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
      "Save information to long-term memory. Categorize it as preference (stable user preference), fact (stable fact), task (expires after 30 days), or project (expires after 180 days). Similar memories are merged automatically.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The information to remember, written as a clear factual statement.",
        },
        category: {
          type: "string",
          enum: [...MEMORY_CATEGORIES],
          description: "Memory category: preference, fact, task, or project.",
        },
        expires_at: {
          type: ["string", "null"],
          description:
            "Optional ISO 8601 expiration date. Defaults to 30 days for tasks, 180 days for projects, and never for preferences/facts.",
        },
      },
      required: ["content"],
    },
    execute: async (args, tenant) => {
      const content = String(args.content ?? "");
      const category = MEMORY_CATEGORIES.includes(args.category as MemoryCategory)
        ? (args.category as MemoryCategory)
        : "fact";
      const expiresAt =
        args.expires_at === null || typeof args.expires_at === "string"
          ? args.expires_at
          : undefined;
      const entry = await addMemory(tenant.chatId, content, category, expiresAt);
      return `${entry.merged ? "Memory merged" : "Memory saved"} with ID ${entry.id}.`;
    },
  },
  {
    name: "search_memory",
    readOnly: true,
    timeoutMs: 5_000,
    description:
      "Search relevant, non-expired long-term memories for this chat instead of loading every memory.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords or a short question to search for." },
        category: { type: "string", enum: [...MEMORY_CATEGORIES] },
      },
      required: ["query"],
    },
    execute: async (args, tenant) => {
      const category = MEMORY_CATEGORIES.includes(args.category as MemoryCategory)
        ? (args.category as MemoryCategory)
        : undefined;
      const results = searchMemories(tenant.chatId, String(args.query ?? ""), { category });
      return results.length
        ? results.map((entry) => `[${entry.id}] (${entry.category}) ${entry.content}`).join("\n")
        : "No matching memories found.";
    },
  },
  {
    name: "update_memory",
    description:
      "Correct an existing memory by ID. Use this instead of saving a duplicate when remembered information changes.",
    parameters: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "ID of the memory to update." },
        content: { type: "string", description: "Corrected memory content." },
        category: { type: "string", enum: [...MEMORY_CATEGORIES] },
        expires_at: {
          type: ["string", "null"],
          description: "New ISO 8601 expiration date, or null to make the memory permanent.",
        },
      },
      required: ["memory_id"],
    },
    execute: async (args, tenant) => {
      const patch = memoryUpdatePatch(args);
      if (!patch) return EMPTY_MEMORY_UPDATE_RESULT;
      const entry = await updateMemory(tenant.chatId, String(args.memory_id ?? ""), patch);
      return entry ? `Memory ${entry.id} updated.` : `Memory ${args.memory_id} not found.`;
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
              const expiry = m.expiresAt
                ? new Date(m.expiresAt).toLocaleDateString("en-US")
                : "never";
              return `| \`${m.id}\` | ${m.category} | ${local} | ${expiry} | ${content} |`;
            });
            const md = [
              `## Memories (${memories.length})`,
              "",
              "| ID | Category | Created | Expires | Content |",
              "|---|---|---|---|---|",
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
