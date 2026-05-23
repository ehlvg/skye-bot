import { getDb } from "./db.js";

export interface ChatApiConfig {
  apiKey?: string;
  baseUrl?: string;
  fastMode: boolean;
  voiceMode: boolean;
}

type ConfigRow = {
  apiKey: string | null;
  baseUrl: string | null;
  fastMode: number;
  voiceMode: number;
};

export function getChatConfig(chatId: number): ChatApiConfig {
  const row = getDb()
    .prepare<[number], ConfigRow>(
      "SELECT api_key AS apiKey, base_url AS baseUrl, fast_mode AS fastMode, voice_mode AS voiceMode FROM chat_configs WHERE chat_id = ?"
    )
    .get(chatId);
  if (!row) return { fastMode: false, voiceMode: false };
  return {
    ...(row.apiKey != null ? { apiKey: row.apiKey } : {}),
    ...(row.baseUrl != null ? { baseUrl: row.baseUrl } : {}),
    fastMode: row.fastMode === 1,
    voiceMode: row.voiceMode === 1,
  };
}

export async function setChatApiKey(chatId: number, apiKey: string): Promise<void> {
  getDb()
    .prepare(
      `INSERT INTO chat_configs (chat_id, api_key) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET api_key = excluded.api_key`
    )
    .run(chatId, apiKey);
}

export async function setChatBaseUrl(chatId: number, baseUrl: string): Promise<void> {
  getDb()
    .prepare(
      `INSERT INTO chat_configs (chat_id, base_url) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET base_url = excluded.base_url`
    )
    .run(chatId, baseUrl);
}

export function setChatFastMode(chatId: number, enabled: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO chat_configs (chat_id, fast_mode) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET fast_mode = excluded.fast_mode`
    )
    .run(chatId, enabled ? 1 : 0);
}

export function setChatVoiceMode(chatId: number, enabled: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO chat_configs (chat_id, voice_mode) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET voice_mode = excluded.voice_mode`
    )
    .run(chatId, enabled ? 1 : 0);
}

export async function resetChatApiKey(chatId: number): Promise<void> {
  getDb().prepare("UPDATE chat_configs SET api_key = NULL WHERE chat_id = ?").run(chatId);
  getDb()
    .prepare(
      "DELETE FROM chat_configs WHERE chat_id = ? AND api_key IS NULL AND base_url IS NULL AND fast_mode = 0 AND voice_mode = 0"
    )
    .run(chatId);
}

export async function resetChatBaseUrl(chatId: number): Promise<void> {
  getDb().prepare("UPDATE chat_configs SET base_url = NULL WHERE chat_id = ?").run(chatId);
  getDb()
    .prepare(
      "DELETE FROM chat_configs WHERE chat_id = ? AND api_key IS NULL AND base_url IS NULL AND fast_mode = 0 AND voice_mode = 0"
    )
    .run(chatId);
}
