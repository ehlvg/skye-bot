import { getDb } from "../../core/db.js";

export interface ChatApiConfig {
  apiKey?: string;
  baseUrl?: string;
  voiceMode: boolean;
}

type ConfigRow = {
  apiKey: string | null;
  baseUrl: string | null;
  voiceMode: number;
};

export function getChatConfig(chatId: number): ChatApiConfig {
  const row = getDb()
    .prepare<
      [number],
      ConfigRow
    >("SELECT api_key AS apiKey, base_url AS baseUrl, voice_mode AS voiceMode FROM chat_configs WHERE chat_id = ?")
    .get(chatId);
  if (!row) return { voiceMode: false };
  return {
    ...(row.apiKey != null ? { apiKey: row.apiKey } : {}),
    ...(row.baseUrl != null ? { baseUrl: row.baseUrl } : {}),
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
      "DELETE FROM chat_configs WHERE chat_id = ? AND api_key IS NULL AND base_url IS NULL AND voice_mode = 0"
    )
    .run(chatId);
}

export async function resetChatBaseUrl(chatId: number): Promise<void> {
  getDb().prepare("UPDATE chat_configs SET base_url = NULL WHERE chat_id = ?").run(chatId);
  getDb()
    .prepare(
      "DELETE FROM chat_configs WHERE chat_id = ? AND api_key IS NULL AND base_url IS NULL AND voice_mode = 0"
    )
    .run(chatId);
}

export interface ChatConfigService {
  get(chatId: number): ChatApiConfig;
  setApiKey(chatId: number, apiKey: string): Promise<void>;
  setBaseUrl(chatId: number, baseUrl: string): Promise<void>;
  setVoiceMode(chatId: number, enabled: boolean): void;
  resetApiKey(chatId: number): Promise<void>;
  resetBaseUrl(chatId: number): Promise<void>;
}

export const chatConfigService: ChatConfigService = {
  get: getChatConfig,
  setApiKey: setChatApiKey,
  setBaseUrl: setChatBaseUrl,
  setVoiceMode: setChatVoiceMode,
  resetApiKey: resetChatApiKey,
  resetBaseUrl: resetChatBaseUrl,
};
