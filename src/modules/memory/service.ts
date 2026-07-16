import { randomUUID } from "node:crypto";
import { getDb } from "../../core/db.js";

export const MEMORY_CATEGORIES = ["preference", "fact", "task", "project"] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

const DEFAULT_EXPIRY_DAYS: Record<MemoryCategory, number | null> = {
  preference: null,
  fact: null,
  task: 30,
  project: 180,
};
const MAX_CONTENT_LENGTH = 2_000;
const MAX_SEARCH_RESULTS = 50;
const CONTEXT_PREFERENCE_LIMIT = 4;

export interface MemoryEntry {
  id: string;
  content: string;
  category?: MemoryCategory;
  createdAt: string;
  updatedAt?: string;
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  archivedAt?: string | null;
  chatId?: number;
  merged?: boolean;
}

export interface MemoryInput {
  content: string;
  category?: MemoryCategory;
  expiresAt?: string | null;
  createdAt?: string;
  id?: string;
}

export interface MemorySearchOptions {
  category?: MemoryCategory;
  limit?: number;
}

export interface MemoryUpdateInput {
  content?: string;
  category?: MemoryCategory;
  expiresAt?: string | null;
}

export const EMPTY_MEMORY_UPDATE_RESULT =
  "Memory update requires content, category, or expires_at.";

export function memoryUpdatePatch(args: Record<string, unknown>): MemoryUpdateInput | null {
  const category = MEMORY_CATEGORIES.includes(args.category as MemoryCategory)
    ? (args.category as MemoryCategory)
    : undefined;
  const patch: MemoryUpdateInput = {
    ...(typeof args.content === "string" ? { content: args.content } : {}),
    ...(category ? { category } : {}),
    ...(args.expires_at === null || typeof args.expires_at === "string"
      ? { expiresAt: args.expires_at }
      : {}),
  };
  return Object.keys(patch).length > 0 ? patch : null;
}

interface MemoryRow {
  id: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  archivedAt: string | null;
  chatId?: number;
}

function generateId(): string {
  return `mem_${randomUUID()}`;
}

function categoryOf(value: unknown): MemoryCategory {
  return MEMORY_CATEGORIES.includes(value as MemoryCategory) ? (value as MemoryCategory) : "fact";
}

function expiryFor(category: MemoryCategory, now: Date, expiresAt?: string | null): string | null {
  if (expiresAt !== undefined) {
    if (expiresAt === null) return null;
    const parsed = new Date(expiresAt);
    if (Number.isNaN(parsed.getTime())) throw new Error("Memory expiration must be a valid date");
    return parsed.toISOString();
  }
  const days = DEFAULT_EXPIRY_DAYS[category];
  if (days === null) return null;
  const expiry = new Date(now);
  expiry.setUTCDate(expiry.getUTCDate() + days);
  return expiry.toISOString();
}

function normalizeContent(content: string): string {
  const normalized = content.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("Memory content must not be empty");
  if (normalized.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Memory content must be at most ${MAX_CONTENT_LENGTH} characters`);
  }
  return normalized;
}

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(" ")
      .filter((token) => token.length > 2)
  );
}

function similarity(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  if (left.size === 0 || right.size === 0) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / new Set([...left, ...right]).size;
}

function toEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    content: row.content,
    category: categoryOf(row.category),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    archivedAt: row.archivedAt,
    ...(row.chatId === undefined ? {} : { chatId: row.chatId }),
  };
}

function archiveExpiredMemories(chatId: number, now = new Date().toISOString()): void {
  getDb()
    .prepare(
      "UPDATE memories SET archived_at = ? WHERE chat_id = ? AND archived_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?"
    )
    .run(now, chatId, now);
}

const SELECT_COLUMNS = `
  id, content, category, created_at AS createdAt, updated_at AS updatedAt,
  last_used_at AS lastUsedAt, expires_at AS expiresAt, archived_at AS archivedAt`;

export function getMemories(chatId: number): MemoryEntry[] {
  archiveExpiredMemories(chatId);
  return getDb()
    .prepare<[number], MemoryRow>(
      `SELECT ${SELECT_COLUMNS} FROM memories
       WHERE chat_id = ? AND archived_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY created_at`
    )
    .all(chatId)
    .map(toEntry);
}

export function searchMemories(
  chatId: number,
  query: string,
  options: MemorySearchOptions = {}
): MemoryEntry[] {
  archiveExpiredMemories(chatId);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), MAX_SEARCH_RESULTS);
  const category = options.category;
  const candidates = category
    ? getDb()
        .prepare<[number, MemoryCategory], MemoryRow>(
          `SELECT ${SELECT_COLUMNS} FROM memories WHERE chat_id = ? AND category = ?
         AND archived_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY updated_at DESC LIMIT 500`
        )
        .all(chatId, category)
    : getDb()
        .prepare<[number], MemoryRow>(
          `SELECT ${SELECT_COLUMNS} FROM memories WHERE chat_id = ?
         AND archived_at IS NULL AND (expires_at IS NULL OR expires_at > datetime('now'))
         ORDER BY updated_at DESC LIMIT 500`
        )
        .all(chatId);
  const cleanQuery = query.trim();
  if (!cleanQuery) return candidates.slice(0, limit).map(toEntry);
  const ranked = candidates
    .map((row) => ({ row, score: similarity(cleanQuery, row.content) }))
    .filter(({ score, row }) => score > 0 || rowContainsPhrase(cleanQuery, row.content))
    .sort((a, b) => b.score - a.score || b.row.updatedAt.localeCompare(a.row.updatedAt))
    .slice(0, limit)
    .map(({ row }) => row);
  const result = ranked.map(toEntry);
  if (result.length > 0) {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE memories SET last_used_at = ? WHERE chat_id = ? AND id IN (${result.map(() => "?").join(",")})`
      )
      .run(now, chatId, ...result.map((entry) => entry.id));
    for (const entry of result) entry.lastUsedAt = now;
  }
  return result;
}

function rowContainsPhrase(query: string, content: string): boolean {
  return content.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function mergedContent(existing: string, incoming: string): string {
  if (existing.toLocaleLowerCase() === incoming.toLocaleLowerCase()) return existing;
  if (rowContainsPhrase(existing, incoming)) return incoming;
  if (rowContainsPhrase(incoming, existing)) return existing;
  // Highly similar, equally specific statements usually represent a correction
  // (for example, "favorite color is blue" -> "favorite color is green").
  return incoming;
}

function addMemorySync(
  chatId: number,
  rawContent: string,
  category: MemoryCategory = "fact",
  expiresAt?: string | null
): MemoryEntry {
  const content = normalizeContent(rawContent);
  const now = new Date();
  const createdAt = now.toISOString();
  const validCategory = categoryOf(category);
  archiveExpiredMemories(chatId, createdAt);

  const existing = getDb()
    .prepare<[number, MemoryCategory, string], MemoryRow>(
      `SELECT ${SELECT_COLUMNS} FROM memories
       WHERE chat_id = ? AND category = ? AND archived_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`
    )
    .all(chatId, validCategory, createdAt)
    .find(
      (row) =>
        similarity(content, row.content) >= 0.8 ||
        rowContainsPhrase(content, row.content) ||
        rowContainsPhrase(row.content, content)
    );

  if (existing) {
    const contentAfterMerge = mergedContent(existing.content, content);
    const mergedExpiry =
      expiresAt === undefined ? existing.expiresAt : expiryFor(validCategory, now, expiresAt);
    getDb()
      .prepare(
        "UPDATE memories SET content = ?, updated_at = ?, last_used_at = ?, expires_at = ? WHERE chat_id = ? AND id = ?"
      )
      .run(contentAfterMerge, createdAt, createdAt, mergedExpiry, chatId, existing.id);
    return {
      ...toEntry({
        ...existing,
        content: contentAfterMerge,
        updatedAt: createdAt,
        lastUsedAt: createdAt,
        expiresAt: mergedExpiry,
      }),
      merged: true,
    };
  }

  const entry: MemoryEntry = {
    id: generateId(),
    content,
    category: validCategory,
    createdAt,
    updatedAt: createdAt,
    lastUsedAt: null,
    expiresAt: expiryFor(validCategory, now, expiresAt),
    archivedAt: null,
  };
  getDb()
    .prepare(
      "INSERT INTO memories (id, chat_id, content, category, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      entry.id,
      chatId,
      entry.content,
      entry.category,
      entry.createdAt,
      entry.updatedAt,
      entry.expiresAt
    );
  return entry;
}

export function contextMemories(chatId: number, query: string, limit = 12): MemoryEntry[] {
  const safeLimit = Math.min(Math.max(limit, 1), MAX_SEARCH_RESULTS);
  const relevant = searchMemories(chatId, query, { limit: safeLimit });
  const preferences = getDb()
    .prepare<[number, number], MemoryRow>(
      `SELECT ${SELECT_COLUMNS} FROM memories
       WHERE chat_id = ? AND category = 'preference' AND archived_at IS NULL
         AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY updated_at DESC
       LIMIT ?`
    )
    .all(chatId, Math.min(CONTEXT_PREFERENCE_LIMIT, safeLimit))
    .map(toEntry);
  const seen = new Set<string>();
  const result = [...preferences, ...relevant].filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  const selected = result.slice(0, safeLimit);
  if (preferences.length > 0) {
    const now = new Date().toISOString();
    const selectedPreferenceIds = selected
      .filter((entry) => entry.category === "preference")
      .map((entry) => entry.id);
    if (selectedPreferenceIds.length > 0) {
      getDb()
        .prepare(
          `UPDATE memories SET last_used_at = ? WHERE chat_id = ? AND id IN (${selectedPreferenceIds.map(() => "?").join(",")})`
        )
        .run(now, chatId, ...selectedPreferenceIds);
      for (const entry of selected) {
        if (selectedPreferenceIds.includes(entry.id)) entry.lastUsedAt = now;
      }
    }
  }
  return selected;
}

export async function updateMemory(
  chatId: number,
  id: string,
  patch: MemoryUpdateInput
): Promise<MemoryEntry | null> {
  const now = new Date();
  const updatedAt = now.toISOString();
  archiveExpiredMemories(chatId, updatedAt);
  const existing = getDb()
    .prepare<[number, string, string], MemoryRow>(
      `SELECT ${SELECT_COLUMNS} FROM memories
       WHERE chat_id = ? AND id = ? AND archived_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`
    )
    .get(chatId, id, updatedAt);
  if (!existing) return null;
  if (
    patch.content === undefined &&
    patch.category === undefined &&
    patch.expiresAt === undefined
  ) {
    throw new Error("Memory update must change content, category, or expiration");
  }

  const category =
    patch.category === undefined ? categoryOf(existing.category) : categoryOf(patch.category);
  const content = patch.content === undefined ? existing.content : normalizeContent(patch.content);
  const expiresAt =
    patch.expiresAt !== undefined
      ? expiryFor(category, now, patch.expiresAt)
      : patch.category !== undefined && category !== categoryOf(existing.category)
        ? expiryFor(category, now)
        : existing.expiresAt;
  getDb()
    .prepare(
      `UPDATE memories SET content = ?, category = ?, expires_at = ?, updated_at = ?
       WHERE chat_id = ? AND id = ?`
    )
    .run(content, category, expiresAt, updatedAt, chatId, id);
  return toEntry({ ...existing, content, category, expiresAt, updatedAt });
}

export async function addMemory(
  chatId: number,
  rawContent: string,
  category: MemoryCategory = "fact",
  expiresAt?: string | null
): Promise<MemoryEntry> {
  return addMemorySync(chatId, rawContent, category, expiresAt);
}

export interface ImportedMemory extends MemoryInput {
  chatId?: number;
}

export async function importMemories(
  chatId: number,
  records: MemoryInput[]
): Promise<{ imported: number; merged: number }> {
  if (!Array.isArray(records) || records.length === 0 || records.length > 1_000)
    throw new Error("Import must contain between 1 and 1000 memories");
  let imported = 0;
  let merged = 0;

  // addMemorySync is deliberately used inside the transaction: an async
  // function would turn a synchronous validation error into a rejected
  // promise, which better-sqlite3 could not roll back reliably.
  getDb().transaction(() => {
    for (const record of records) {
      const entry = addMemorySync(
        chatId,
        record.content,
        categoryOf(record.category),
        record.expiresAt
      );
      if (entry.merged) merged++;
      else imported++;
    }
  })();
  return { imported, merged };
}

export function exportMemories(chatId: number, includeArchived = false): MemoryEntry[] {
  if (!includeArchived) archiveExpiredMemories(chatId);
  const where = includeArchived ? "" : "AND archived_at IS NULL";
  return getDb()
    .prepare<
      [number],
      MemoryRow
    >(`SELECT ${SELECT_COLUMNS}, chat_id AS chatId FROM memories WHERE chat_id = ? ${where} ORDER BY created_at`)
    .all(chatId)
    .map(toEntry);
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
  const args = JSON.parse(toolCall.arguments) as Record<string, unknown>;
  switch (toolCall.name) {
    case "save_memory": {
      const entry = await addMemory(
        chatId,
        String(args.content ?? ""),
        categoryOf(args.category),
        typeof args.expires_at === "string" ? args.expires_at : undefined
      );
      return `${entry.merged ? "Memory merged" : "Memory saved"} with ID ${entry.id}.`;
    }
    case "search_memory": {
      const category = MEMORY_CATEGORIES.includes(args.category as MemoryCategory)
        ? (args.category as MemoryCategory)
        : undefined;
      const results = searchMemories(chatId, String(args.query ?? ""), {
        category,
      });
      return results.length
        ? results.map((entry) => `[${entry.id}] (${entry.category}) ${entry.content}`).join("\n")
        : "No matching memories found.";
    }
    case "update_memory": {
      const patch = memoryUpdatePatch(args);
      if (!patch) return EMPTY_MEMORY_UPDATE_RESULT;
      const entry = await updateMemory(chatId, String(args.memory_id ?? ""), patch);
      return entry ? `Memory ${entry.id} updated.` : `Memory ${args.memory_id} not found.`;
    }
    case "delete_memory": {
      const ok = await deleteMemory(chatId, String(args.memory_id ?? ""));
      return ok ? `Memory ${args.memory_id} deleted.` : `Memory ${args.memory_id} not found.`;
    }
    default:
      return `Unknown tool: ${toolCall.name}`;
  }
}

export interface MemoryService {
  list(chatId: number): MemoryEntry[];
  search(chatId: number, query: string, options?: MemorySearchOptions): MemoryEntry[];
  context(chatId: number, query: string, limit?: number): MemoryEntry[];
  add(
    chatId: number,
    content: string,
    category?: MemoryCategory,
    expiresAt?: string | null
  ): Promise<MemoryEntry>;
  import(chatId: number, records: MemoryInput[]): Promise<{ imported: number; merged: number }>;
  export(chatId: number, includeArchived?: boolean): MemoryEntry[];
  update(chatId: number, id: string, patch: MemoryUpdateInput): Promise<MemoryEntry | null>;
  delete(chatId: number, id: string): Promise<boolean>;
  clear(chatId: number): Promise<void>;
}

export const memoryService: MemoryService = {
  list: getMemories,
  search: searchMemories,
  context: contextMemories,
  add: addMemory,
  import: importMemories,
  export: exportMemories,
  update: updateMemory,
  delete: deleteMemory,
  clear: clearMemories,
};
