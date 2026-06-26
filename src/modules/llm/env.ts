import { z } from "zod";

export const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1),
  multiplier: z.coerce.number().positive().default(1),
});
export type ModelEntry = z.infer<typeof modelSchema>;

const modelsArray = z
  .string()
  .transform((raw, ctx): ModelEntry[] => {
    try {
      const parsed = JSON.parse(raw);
      const arr = z.array(modelSchema).safeParse(parsed);
      if (!arr.success) {
        ctx.addIssue({ code: "custom", message: "invalid models array" });
        return z.NEVER;
      }
      return arr.data;
    } catch {
      ctx.addIssue({ code: "custom", message: "models must be a JSON array" });
      return z.NEVER;
    }
  });

const defaultModels: ModelEntry[] = [
  { id: "sydney", name: "Sydney", model: "google/gemini-3.1-flash-lite", multiplier: 1 },
  { id: "tokyo", name: "Tokyo", model: "openai/gpt-oss-20b", multiplier: 1.5 },
  { id: "berlin", name: "Berlin", model: "anthropic/claude-3.7-sonnet", multiplier: 2.5 },
  { id: "toronto", name: "Toronto", model: "openai/gpt-5.5", multiplier: 4 },
];

export const llmEnvSchema = z.object({
  OPENAI_KEY: z.string().min(1, "OPENAI_KEY is required"),
  BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  MODELS: modelsArray.default(defaultModels),
  /** Masked id of the model new subscribers start on. */
  DEFAULT_MODEL_ID: z.string().default("sydney"),
  MAX_COMPLETION_TOKENS: z.coerce.number().positive().default(500),
  // Set to "true" to use Chat Completions API instead of Responses API.
  USE_CHAT_COMPLETIONS: z.coerce.boolean().default(false),
  // Image generation/editing provider — separate from chat. Defaults to empty,
  // which falls back to the main BASE_URL/OPENAI_KEY. Uses the OpenRouter-style
  // dedicated Image API (`/images`), so the provider must support it.
  IMAGE_BASE_URL: z.string().url().or(z.literal("")).default(""),
  IMAGE_API_KEY: z.string().default(""),
  IMAGE_MODEL: z.string().default("google/gemini-3.1-flash-image-preview"),
  // PDF parsing engine for file inputs: "mistral-ocr", "cloudflare-ai", "native",
  // or "" (auto). Used when the provider supports OpenRouter-style file-parser
  // plugins. Ignored for providers that don't support the plugins parameter.
  PDF_ENGINE: z.string().default(""),
  // Maximum PDF file size to accept, in bytes (default 25 MB).
  PDF_MAX_BYTES: z.coerce.number().positive().default(25 * 1024 * 1024),
  // Bot owner / author — shown in the system prompt as a higher-weight user.
  OWNER_NAME: z.string().default(""),
  OWNER_TAG: z.string().default(""),
});

export type LlmEnv = z.infer<typeof llmEnvSchema>;