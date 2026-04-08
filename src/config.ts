import "dotenv/config";

export const BOT_TOKEN = process.env.BOT_TOKEN ?? "";
export const OPENAI_KEY = process.env.OPENAI_KEY ?? "";
export const MODEL = process.env.MODEL ?? "openai/gpt-oss-120b";
export const BASE_URL = process.env.BASE_URL ?? "https://openrouter.ai/api/v1";
export const MAX_COMPLETION_TOKENS = parseInt(process.env.MAX_COMPLETION_TOKENS ?? "500");

export const ALLOWED_IDS: Set<number> = new Set(
  (process.env.ALLOWED_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n))
);

export const YC_API_KEY = process.env.YC_API_KEY ?? "";
export const YC_FOLDER_ID = process.env.YC_FOLDER_ID ?? "";

export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
// Rachel — спокойный женский голос (американский акцент)
export const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
