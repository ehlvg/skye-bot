import { z } from "zod";

export const llmEnvSchema = z.object({
  OPENAI_KEY: z.string().min(1, "OPENAI_KEY is required"),
  MODEL: z.string().default("openai/gpt-oss-120b"),
  BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  MAX_COMPLETION_TOKENS: z.coerce.number().positive().default(500),
  // Set to "true" to use Chat Completions API instead of Responses API.
  // Most third-party providers (Ollama, vLLM, etc.) only support Chat
  // Completions. Responses API remains the default for OpenRouter / OpenAI.
  USE_CHAT_COMPLETIONS: z.coerce.boolean().default(false),
  // Image generation/editing provider — separate from chat. Defaults to empty,
  // which falls back to the main BASE_URL/OPENAI_KEY. Uses the OpenRouter-style
  // dedicated Image API (`/images`), so the provider must support it
  // (OpenRouter does).
  IMAGE_BASE_URL: z.string().url().or(z.literal("")).default(""),
  IMAGE_API_KEY: z.string().default(""),
  IMAGE_MODEL: z.string().default("google/gemini-3.1-flash-image-preview"),
});

export type LlmEnv = z.infer<typeof llmEnvSchema>;
