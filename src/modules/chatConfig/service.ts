import { getDb } from "../../core/db.js";

export interface ChatApiConfig {
  voiceMode: boolean;
}

type ConfigRow = {
  voiceMode: number;
};

export function getChatConfig(chatId: number): ChatApiConfig {
  const row = getDb()
    .prepare<
      [number],
      ConfigRow
    >("SELECT voice_mode AS voiceMode FROM chat_configs WHERE chat_id = ?")
    .get(chatId);
  if (!row) return { voiceMode: false };
  return { voiceMode: row.voiceMode === 1 };
}

export function setChatVoiceMode(chatId: number, enabled: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO chat_configs (chat_id, voice_mode) VALUES (?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET voice_mode = excluded.voice_mode`
    )
    .run(chatId, enabled ? 1 : 0);
}

export function resetChatVoiceMode(chatId: number): void {
  getDb()
    .prepare(
      "DELETE FROM chat_configs WHERE chat_id = ? AND voice_mode = 0"
    )
    .run(chatId);
}

export interface ChatConfigService {
  get(chatId: number): ChatApiConfig;
  setVoiceMode(chatId: number, enabled: boolean): void;
  resetVoiceMode(chatId: number): void;
}

export const chatConfigService: ChatConfigService = {
  get: getChatConfig,
  setVoiceMode: setChatVoiceMode,
  resetVoiceMode: resetChatVoiceMode,
};