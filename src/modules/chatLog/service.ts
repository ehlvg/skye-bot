import { getDb } from "../../core/db.js";

const MAX_BUFFER = 50;
const RECENT_COUNT = 20;
const MAX_STORED_CONVERSATION_ITEMS = 60;
const MAX_STORED_GROUP_MESSAGES = 400;

export interface LogEntry {
  messageId?: number;
  sender: string;
  timestamp: string;
  type: string;
  content: string;
  replyTo?: string;
}

export interface GroupMessage {
  messageId: number | null;
  sender: string;
  timestamp: string;
  type: string;
  content: string;
  replyTo?: string;
}

export interface ConversationItem {
  messageId?: number;
  role: "user" | "assistant" | "tool";
  content: unknown;
  text: string;
  createdAt: string;
}

type ConversationRow = {
  messageId: number | null;
  role: "user" | "assistant" | "tool";
  contentJson: string;
  text: string;
  createdAt: string;
};

// In-memory ring buffers keyed by chatId (reset on restart is acceptable)
const logs = new Map<number, LogEntry[]>();
const chatTitles = new Map<number, string>();

function pruneConversation(chatId: number, threadKey: string): void {
  getDb()
    .prepare(
      `DELETE FROM conversation_items
       WHERE id IN (
         SELECT id FROM conversation_items
         WHERE chat_id = ? AND thread_key = ?
         ORDER BY id DESC
         LIMIT -1 OFFSET ?
       )`
    )
    .run(chatId, threadKey, MAX_STORED_CONVERSATION_ITEMS);
}

export function appendConversationItem(
  chatId: number,
  threadKey: string,
  item: Omit<ConversationItem, "createdAt"> & { createdAt?: string }
): void {
  const createdAt = item.createdAt ?? new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO conversation_items
        (chat_id, thread_key, message_id, role, content_json, text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      chatId,
      threadKey,
      item.messageId ?? null,
      item.role,
      JSON.stringify(item.content),
      item.text,
      createdAt
    );
  pruneConversation(chatId, threadKey);
}

export function listConversationItems(
  chatId: number,
  threadKey: string,
  limit = 30
): ConversationItem[] {
  const rows = getDb()
    .prepare<[number, string, number], ConversationRow>(
      `SELECT message_id AS messageId, role, content_json AS contentJson, text, created_at AS createdAt
       FROM conversation_items
       WHERE chat_id = ? AND thread_key = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(chatId, threadKey, limit);

  return rows.reverse().map((row) => ({
    ...(row.messageId != null ? { messageId: row.messageId } : {}),
    role: row.role,
    content: JSON.parse(row.contentJson) as unknown,
    text: row.text,
    createdAt: row.createdAt,
  }));
}

export function clearConversationItems(chatId: number, threadKey: string): void {
  getDb()
    .prepare("DELETE FROM conversation_items WHERE chat_id = ? AND thread_key = ?")
    .run(chatId, threadKey);
}

export function countConversationItems(chatId: number, threadKey?: string): number {
  if (threadKey) {
    const row = getDb()
      .prepare<
        [number, string],
        { count: number }
      >("SELECT COUNT(*) AS count FROM conversation_items WHERE chat_id = ? AND thread_key = ?")
      .get(chatId, threadKey);
    return row?.count ?? 0;
  }
  const row = getDb()
    .prepare<
      [number],
      { count: number }
    >("SELECT COUNT(*) AS count FROM conversation_items WHERE chat_id = ?")
    .get(chatId);
  return row?.count ?? 0;
}

export function findConversationText(chatId: number, messageId: number): string | undefined {
  const row = getDb()
    .prepare<[number, number], { text: string }>(
      `SELECT text FROM conversation_items
       WHERE chat_id = ? AND message_id = ?
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(chatId, messageId);
  return row?.text;
}

export function formatLogEntry(entry: LogEntry): string {
  const time = entry.timestamp;
  const reply = entry.replyTo ? ` (replying to ${entry.replyTo})` : "";
  const typeTag = entry.type !== "text" ? `[${entry.type}] ` : "";
  return `[${time}] ${entry.sender}${reply}: ${typeTag}${entry.content}`;
}

/** Push a message to the buffer and persist to DB. */
export function logMessage(
  chatId: number,
  entry: LogEntry,
  chatTitle?: string
): void {
  if (chatTitle) chatTitles.set(chatId, chatTitle);
  if (!logs.has(chatId)) logs.set(chatId, []);
  const buf = logs.get(chatId)!;
  buf.push(entry);
  if (buf.length > MAX_BUFFER) buf.shift();

  getDb()
    .prepare(
      `INSERT INTO group_messages (chat_id, message_id, sender, timestamp, type, content, reply_to)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      chatId,
      entry.messageId ?? null,
      entry.sender,
      entry.timestamp,
      entry.type,
      entry.content,
      entry.replyTo ?? null
    );
  pruneGroupMessages(chatId);
}

function pruneGroupMessages(chatId: number): void {
  getDb()
    .prepare(
      `DELETE FROM group_messages
       WHERE id IN (
         SELECT id FROM group_messages
         WHERE chat_id = ?
         ORDER BY id DESC
         LIMIT -1 OFFSET ?
       )`
    )
    .run(chatId, MAX_STORED_GROUP_MESSAGES);
}

/**
 * Reload a chat's in-memory log buffer from the DB. Called at startup so
 * Skye is aware of group activity that happened before (re)start.
 */
export function loadChatLog(chatId: number): void {
  const rows = getDb()
    .prepare<
      [number, number],
      {
        sender: string;
        timestamp: string;
        type: string;
        content: string;
        reply_to: string | null;
      }
    >(
      `SELECT sender, timestamp, type, content, reply_to
       FROM group_messages
       WHERE chat_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(chatId, MAX_BUFFER);
  const buf = rows.reverse().map((r) => ({
    sender: r.sender,
    timestamp: r.timestamp,
    type: r.type,
    content: r.content,
    ...(r.reply_to != null ? { replyTo: r.reply_to } : {}),
  }));
  logs.set(chatId, buf);
}

export function getChatContext(
  chatId: number
): { chatTitle: string; recentLog: string } | undefined {
  const buf = logs.get(chatId);
  if (!buf || buf.length === 0) return undefined;
  const title = chatTitles.get(chatId) ?? "Unknown Chat";
  const recent = buf.slice(-RECENT_COUNT);
  const recentLog = recent.map(formatLogEntry).join("\n");
  return { chatTitle: title, recentLog };
}

/**
 * Return the last N group messages (with Telegram message_ids) so proactive
 * features can target a specific message to react to.
 */
export function recentGroupMessages(chatId: number, limit = 30): GroupMessage[] {
  const rows = getDb()
    .prepare<
      [number, number],
      {
        message_id: number | null;
        sender: string;
        timestamp: string;
        type: string;
        content: string;
        reply_to: string | null;
      }
    >(
      `SELECT message_id, sender, timestamp, type, content, reply_to
       FROM group_messages
       WHERE chat_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(chatId, limit);
  return rows.reverse().map((r) => ({
    messageId: r.message_id,
    sender: r.sender,
    timestamp: r.timestamp,
    type: r.type,
    content: r.content,
    ...(r.reply_to != null ? { replyTo: r.reply_to } : {}),
  }));
}

/**
 * Return group messages within a time range [since, until), formatted as
 * a single string ready for the LLM. Used by reminder digests and other
 * time-bounded context queries.
 */
export function groupMessagesSince(
  chatId: number,
  since: Date,
  until: Date = new Date()
): GroupMessage[] {
  const rows = getDb()
    .prepare<
      [number, number, string, string],
      {
        message_id: number | null;
        sender: string;
        timestamp: string;
        type: string;
        content: string;
        reply_to: string | null;
      }
    >(
      `SELECT message_id, sender, timestamp, type, content, reply_to
       FROM group_messages
       WHERE chat_id = ? AND id > (
         SELECT COALESCE(MAX(id), 0) FROM group_messages
         WHERE chat_id = ? AND timestamp <= ?
       )
       AND timestamp < ?
       ORDER BY id ASC`
    )
    .all(
      chatId,
      chatId,
      since.toISOString(),
      until.toISOString()
    );
  return rows.map((r) => ({
    messageId: r.message_id,
    sender: r.sender,
    timestamp: r.timestamp,
    type: r.type,
    content: r.content,
    ...(r.reply_to != null ? { replyTo: r.reply_to } : {}),
  }));
}

export interface ChatLogService {
  log(chatId: number, entry: LogEntry, chatTitle?: string): void;
  context(chatId: number): { chatTitle: string; recentLog: string } | undefined;
  appendConversation(
    chatId: number,
    threadKey: string,
    item: Omit<ConversationItem, "createdAt">
  ): void;
  listConversation(chatId: number, threadKey: string, limit?: number): ConversationItem[];
  clearConversation(chatId: number, threadKey: string): void;
  countConversation(chatId: number, threadKey?: string): number;
  findConversationText(chatId: number, messageId: number): string | undefined;
  loadChatLog(chatId: number): void;
  recentGroupMessages(chatId: number, limit?: number): GroupMessage[];
  groupMessagesSince(chatId: number, since: Date, until?: Date): GroupMessage[];
}

export const chatLogService: ChatLogService = {
  log: logMessage,
  context: getChatContext,
  appendConversation: appendConversationItem,
  listConversation: listConversationItems,
  clearConversation: clearConversationItems,
  countConversation: countConversationItems,
  findConversationText,
  loadChatLog,
  recentGroupMessages,
  groupMessagesSince,
};
