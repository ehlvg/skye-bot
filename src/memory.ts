import { getDb } from "./db.js";

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
}

function generateId(): string {
  return "mem_" + Math.random().toString(36).slice(2, 10);
}

export function getMemories(chatId: number): MemoryEntry[] {
  return getDb()
    .query<
      MemoryEntry,
      [number]
    >("SELECT id, content, created_at AS createdAt FROM memories WHERE chat_id = ? ORDER BY created_at")
    .all(chatId);
}

export async function addMemory(chatId: number, content: string): Promise<MemoryEntry> {
  const entry: MemoryEntry = {
    id: generateId(),
    content,
    createdAt: new Date().toISOString(),
  };
  getDb()
    .query("INSERT INTO memories (id, chat_id, content, created_at) VALUES (?, ?, ?, ?)")
    .run(entry.id, chatId, entry.content, entry.createdAt);
  return entry;
}

export async function deleteMemory(chatId: number, id: string): Promise<boolean> {
  const result = getDb().query("DELETE FROM memories WHERE chat_id = ? AND id = ?").run(chatId, id);
  return result.changes > 0;
}

export async function clearMemories(chatId: number): Promise<void> {
  getDb().query("DELETE FROM memories WHERE chat_id = ?").run(chatId);
}

// OpenAI tool definitions
export const memoryTools = [
  {
    type: "function" as const,
    function: {
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
    },
  },
  {
    type: "function" as const,
    function: {
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
    },
  },
];

// Execute a tool call and return the result string
export async function executeMemoryTool(
  chatId: number,
  toolCall: { function: { name: string; arguments: string } }
): Promise<string> {
  const args = JSON.parse(toolCall.function.arguments);

  switch (toolCall.function.name) {
    case "save_memory": {
      const entry = await addMemory(chatId, args.content);
      return `Memory saved with ID ${entry.id}.`;
    }
    case "delete_memory": {
      const ok = await deleteMemory(chatId, args.memory_id);
      return ok ? `Memory ${args.memory_id} deleted.` : `Memory ${args.memory_id} not found.`;
    }
    default:
      return `Unknown tool: ${toolCall.function.name}`;
  }
}
