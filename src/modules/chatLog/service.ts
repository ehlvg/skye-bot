import { getDb } from "../../core/db.js";
import type { ApiCredentials, LlmClient } from "../llm/client.js";
import { log } from "../../utils/log.js";

const MAX_BUFFER = 50;
const RECENT_COUNT = 20;
const SUMMARIZE_INTERVAL = 10;
const MAX_STORED_CONVERSATION_ITEMS = 60;

export interface LogEntry {
  sender: string;
  timestamp: string;
  type: string;
  content: string;
  replyTo?: string;
}

export interface ConversationItem {
  messageId?: number;
  role: "user" | "assistant";
  content: unknown;
  text: string;
  createdAt: string;
}

type ConversationRow = {
  messageId: number | null;
  role: "user" | "assistant";
  contentJson: string;
  text: string;
  createdAt: string;
};

// In-memory ring buffers keyed by chatId (reset on restart is acceptable)
const logs = new Map<number, LogEntry[]>();
const counters = new Map<number, number>();
const chatTitles = new Map<number, string>();

let llmRef: LlmClient | null = null;

/** Wired by the chatLog module's init() so summarizeChat can hit the LLM. */
export function setLlmClient(client: LlmClient): void {
  llmRef = client;
}

function getSummary(chatId: number): string {
  const row = getDb()
    .prepare<[number], { summary: string }>("SELECT summary FROM chat_summaries WHERE chat_id = ?")
    .get(chatId);
  return row?.summary ?? "";
}

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

/** Push a message to the buffer. Returns true if summarization is due. */
export function logMessage(chatId: number, entry: LogEntry, chatTitle?: string): boolean {
  if (chatTitle) chatTitles.set(chatId, chatTitle);
  if (!logs.has(chatId)) logs.set(chatId, []);
  const buf = logs.get(chatId)!;
  buf.push(entry);
  if (buf.length > MAX_BUFFER) buf.shift();
  const count = (counters.get(chatId) ?? 0) + 1;
  counters.set(chatId, count);
  return count >= SUMMARIZE_INTERVAL;
}

export function getOlderEntries(chatId: number): LogEntry[] {
  const buf = logs.get(chatId);
  if (!buf) return [];
  const cutoff = Math.max(0, buf.length - RECENT_COUNT);
  return buf.slice(0, cutoff);
}

export function getChatContext(
  chatId: number
): { chatTitle: string; summary: string; recentLog: string } | undefined {
  const buf = logs.get(chatId);
  if (!buf || buf.length === 0) return undefined;
  const title = chatTitles.get(chatId) ?? "Unknown Chat";
  const summary = getSummary(chatId);
  const recent = buf.slice(-RECENT_COUNT);
  const recentLog = recent.map(formatLogEntry).join("\n");
  return { chatTitle: title, summary, recentLog };
}

export async function setSummary(chatId: number, summary: string): Promise<void> {
  getDb()
    .prepare(
      `INSERT INTO chat_summaries (chat_id, summary) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET summary = excluded.summary`
    )
    .run(chatId, summary);
  counters.set(chatId, 0);
}

export async function summarizeChat(chatId: number, creds?: ApiCredentials): Promise<void> {
  const older = getOlderEntries(chatId);
  if (older.length === 0) {
    counters.set(chatId, 0);
    return;
  }
  if (!llmRef) {
    log.warn(`Chat ${chatId}: summarization skipped — LLM client not wired`);
    counters.set(chatId, 0);
    return;
  }

  const formatted = older.map(formatLogEntry).join("\n");
  const previous = getSummary(chatId);
  const input = previous
    ? `Previous rolling summary:\n${previous}\n\nNew chat log:\n${formatted}`
    : formatted;
  const instructions =
    "You maintain a compact rolling summary for a Telegram group chat. Update the previous summary if present. Keep it under 240 words with these compact sections: Participants, Topics, Decisions, Open questions, Shared media/files, Timeline. Output only the updated summary.";

  try {
    const res = await llmRef.ask(instructions, input, creds);
    const text = res.output_text;
    if (text) {
      await setSummary(chatId, text);
      log.info(`Chat ${chatId}: summarized ${older.length} older messages`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn(`Chat ${chatId}: summarization failed: ${msg}`);
    counters.set(chatId, 0);
  }
}

export interface ChatLogService {
  log(chatId: number, entry: LogEntry, chatTitle?: string): boolean;
  context(chatId: number): { chatTitle: string; summary: string; recentLog: string } | undefined;
  summarize(chatId: number, creds?: ApiCredentials): Promise<void>;
  appendConversation(
    chatId: number,
    threadKey: string,
    item: Omit<ConversationItem, "createdAt">
  ): void;
  listConversation(chatId: number, threadKey: string, limit?: number): ConversationItem[];
  clearConversation(chatId: number, threadKey: string): void;
  countConversation(chatId: number, threadKey?: string): number;
  findConversationText(chatId: number, messageId: number): string | undefined;
}

export const chatLogService: ChatLogService = {
  log: logMessage,
  context: getChatContext,
  summarize: summarizeChat,
  appendConversation: appendConversationItem,
  listConversation: listConversationItems,
  clearConversation: clearConversationItems,
  countConversation: countConversationItems,
  findConversationText,
};
