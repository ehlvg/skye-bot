import { readFileSync, existsSync } from "fs";
import { writeFile, mkdir, access } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const DATA_FILE = join(DATA_DIR, "memories.json");

// In-memory cache
const store = new Map<number, MemoryEntry[]>();

// Load from disk on import
if (existsSync(DATA_FILE)) {
  try {
    const raw = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
    for (const [key, value] of Object.entries(raw)) {
      store.set(Number(key), value as MemoryEntry[]);
    }
  } catch {
    // Corrupted file — start fresh
  }
}

async function persist(): Promise<void> {
  try {
    await access(DATA_DIR);
  } catch {
    await mkdir(DATA_DIR, { recursive: true });
  }
  const obj: Record<string, MemoryEntry[]> = {};
  for (const [k, v] of store) obj[String(k)] = v;
  await writeFile(DATA_FILE, JSON.stringify(obj, null, 2));
}

function generateId(): string {
  return "mem_" + Math.random().toString(36).slice(2, 10);
}

export function getMemories(chatId: number): MemoryEntry[] {
  return store.get(chatId) ?? [];
}

export async function addMemory(chatId: number, content: string): Promise<MemoryEntry> {
  const entry: MemoryEntry = {
    id: generateId(),
    content,
    createdAt: new Date().toISOString(),
  };
  if (!store.has(chatId)) store.set(chatId, []);
  store.get(chatId)!.push(entry);
  await persist();
  return entry;
}

export async function deleteMemory(chatId: number, id: string): Promise<boolean> {
  const entries = store.get(chatId);
  if (!entries) return false;
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;
  entries.splice(idx, 1);
  await persist();
  return true;
}

export async function clearMemories(chatId: number): Promise<void> {
  store.delete(chatId);
  await persist();
}

