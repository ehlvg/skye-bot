import { getDb } from "./db.js";

export interface ChatApiConfig {
  apiKey?: string;
  baseUrl?: string;
}

type ConfigRow = { apiKey: string | null; baseUrl: string | null };

export function getChatConfig(chatId: number): ChatApiConfig {
  const row = getDb()
    .query<
      ConfigRow,
      [number]
    >("SELECT api_key AS apiKey, base_url AS baseUrl FROM chat_configs WHERE chat_id = ?")
    .get(chatId);
  if (!row) return {};
  return {
    ...(row.apiKey != null ? { apiKey: row.apiKey } : {}),
    ...(row.baseUrl != null ? { baseUrl: row.baseUrl } : {}),
  };
}

export async function setChatApiKey(chatId: number, apiKey: string): Promise<void> {
  getDb()
    .query(
      `INSERT INTO chat_configs (chat_id, api_key) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET api_key = excluded.api_key`
    )
    .run(chatId, apiKey);
}

export async function setChatBaseUrl(chatId: number, baseUrl: string): Promise<void> {
  getDb()
    .query(
      `INSERT INTO chat_configs (chat_id, base_url) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET base_url = excluded.base_url`
    )
    .run(chatId, baseUrl);
}

export async function resetChatApiKey(chatId: number): Promise<void> {
  getDb().query("UPDATE chat_configs SET api_key = NULL WHERE chat_id = ?").run(chatId);
  getDb()
    .query("DELETE FROM chat_configs WHERE chat_id = ? AND api_key IS NULL AND base_url IS NULL")
    .run(chatId);
}

export async function resetChatBaseUrl(chatId: number): Promise<void> {
  getDb().query("UPDATE chat_configs SET base_url = NULL WHERE chat_id = ?").run(chatId);
  getDb()
    .query("DELETE FROM chat_configs WHERE chat_id = ? AND api_key IS NULL AND base_url IS NULL")
    .run(chatId);
}
