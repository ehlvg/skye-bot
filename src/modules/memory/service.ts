import { getDb } from "../../core/db.js";
import { randomUUID } from "node:crypto";

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
}

function generateId(): string {
  return `mem_${randomUUID()}`;
}

export function getMemories(chatId: number): MemoryEntry[] {
  return getDb()
    .prepare<
      [number],
      MemoryEntry
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
    .prepare("INSERT INTO memories (id, chat_id, content, created_at) VALUES (?, ?, ?, ?)")
    .run(entry.id, chatId, entry.content, entry.createdAt);
  return entry;
}

export async function deleteMemory(chatId: number, id: string): Promise<boolean> {
  const result = getDb()
    .prepare("DELETE FROM memories WHERE chat_id = ? AND id = ?")
    .run(chatId, id);
  return result.changes > 0;
}

export async function clearMemories(chatId: number): Promise<void> {
  getDb().prepare("DELETE FROM memories WHERE chat_id = ?").run(chatId);
}

export async function executeMemoryTool(
  chatId: number,
  toolCall: { name: string; arguments: string }
): Promise<string> {
  const args = JSON.parse(toolCall.arguments);

  switch (toolCall.name) {
    case "save_memory": {
      const entry = await addMemory(chatId, args.content);
      return `Memory saved with ID ${entry.id}.`;
    }
    case "delete_memory": {
      const ok = await deleteMemory(chatId, args.memory_id);
      return ok ? `Memory ${args.memory_id} deleted.` : `Memory ${args.memory_id} not found.`;
    }
    default:
      return `Unknown tool: ${toolCall.name}`;
  }
}

export interface MemoryService {
  list(chatId: number): MemoryEntry[];
  add(chatId: number, content: string): Promise<MemoryEntry>;
  delete(chatId: number, id: string): Promise<boolean>;
  clear(chatId: number): Promise<void>;
}

export const memoryService: MemoryService = {
  list: getMemories,
  add: addMemory,
  delete: deleteMemory,
  clear: clearMemories,
};
