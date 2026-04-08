import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  OPENAI_KEY: z.string().min(1, "OPENAI_KEY is required"),
  MODEL: z.string().default("openai/gpt-oss-120b"),
  BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  MAX_COMPLETION_TOKENS: z.coerce.number().positive().default(500),
  ALLOWED_IDS: z.string().default(""),
  YC_API_KEY: z.string().default(""),
  YC_FOLDER_ID: z.string().default(""),
  ELEVENLABS_API_KEY: z.string().default(""),
  // Rachel — спокойный женский голос (американский акцент)
  ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),
});

const env = (() => {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
})();

export const BOT_TOKEN = env.BOT_TOKEN;
export const OPENAI_KEY = env.OPENAI_KEY;
export const MODEL = env.MODEL;
export const BASE_URL = env.BASE_URL;
export const MAX_COMPLETION_TOKENS = env.MAX_COMPLETION_TOKENS;

export const ALLOWED_IDS: Set<number> = new Set(
  env.ALLOWED_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n))
);

export const YC_API_KEY = env.YC_API_KEY;
export const YC_FOLDER_ID = env.YC_FOLDER_ID;
export const ELEVENLABS_API_KEY = env.ELEVENLABS_API_KEY;
export const ELEVENLABS_VOICE_ID = env.ELEVENLABS_VOICE_ID;
