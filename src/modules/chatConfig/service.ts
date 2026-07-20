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
  getDb().prepare("DELETE FROM chat_configs WHERE chat_id = ? AND voice_mode = 0").run(chatId);
}

function storedThreadId(threadId?: number): number {
  return threadId ?? 0;
}

export function getChatThreadPrompt(chatId: number, threadId?: number): string | undefined {
  return getDb()
    .prepare<[number, number], { customPrompt: string }>(
      `SELECT custom_prompt AS customPrompt
       FROM chat_thread_prompts
       WHERE chat_id = ? AND thread_id = ?`
    )
    .get(chatId, storedThreadId(threadId))?.customPrompt;
}

export function setChatThreadPrompt(
  chatId: number,
  threadId: number | undefined,
  prompt: string
): void {
  getDb()
    .prepare(
      `INSERT INTO chat_thread_prompts (chat_id, thread_id, custom_prompt, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(chat_id, thread_id) DO UPDATE SET
         custom_prompt = excluded.custom_prompt,
         updated_at = excluded.updated_at`
    )
    .run(chatId, storedThreadId(threadId), prompt, new Date().toISOString());
}

export function resetChatThreadPrompt(chatId: number, threadId?: number): boolean {
  return (
    getDb()
      .prepare("DELETE FROM chat_thread_prompts WHERE chat_id = ? AND thread_id = ?")
      .run(chatId, storedThreadId(threadId)).changes > 0
  );
}

export interface ChatConfigService {
  get(chatId: number): ChatApiConfig;
  setVoiceMode(chatId: number, enabled: boolean): void;
  resetVoiceMode(chatId: number): void;
  getPrompt(chatId: number, threadId?: number): string | undefined;
  setPrompt(chatId: number, threadId: number | undefined, prompt: string): void;
  resetPrompt(chatId: number, threadId?: number): boolean;
}

export const chatConfigService: ChatConfigService = {
  get: getChatConfig,
  setVoiceMode: setChatVoiceMode,
  resetVoiceMode: resetChatVoiceMode,
  getPrompt: getChatThreadPrompt,
  setPrompt: setChatThreadPrompt,
  resetPrompt: resetChatThreadPrompt,
};
