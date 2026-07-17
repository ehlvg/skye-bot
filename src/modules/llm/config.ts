import { z } from "zod";
import { section } from "../../core/config.js";

export const builtinToolSchema = z.enum(["web_search", "fetch_url", "sandbox"]);

export const modelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  model: z.string().min(1),
  multiplier: z.number().positive().default(1),
  contextWindow: z.number().int().positive().default(128_000),
  provider: z.enum(["openrouter", "perplexity"]).optional(),
  builtinTools: z.array(builtinToolSchema).optional(),
  preset: z.string().optional(),
});
export type ModelEntry = z.infer<typeof modelSchema>;

const defaultModels: ModelEntry[] = [
  { id: "sydney", name: "Sydney", model: "google/gemini-3.1-flash-lite", multiplier: 1, contextWindow: 128_000 },
  { id: "tokyo", name: "Tokyo", model: "openai/gpt-oss-20b", multiplier: 1.5, contextWindow: 128_000 },
  { id: "berlin", name: "Berlin", model: "anthropic/claude-3.7-sonnet", multiplier: 2.5, contextWindow: 128_000 },
  { id: "toronto", name: "Toronto", model: "openai/gpt-5.5", multiplier: 4, contextWindow: 128_000 },
];

export const llmConfigSchema = z.object({
  openai_key: z.string().min(1, "openai_key is required"),
  base_url: z.string().url().default("https://openrouter.ai/api/v1"),
  models: z.array(modelSchema).default(defaultModels),
  default_model_id: z.string().default("sydney"),
  max_completion_tokens: z.number().int().positive().default(500),
  use_chat_completions: z.boolean().default(false),
  image: section({
      base_url: z.string().url().or(z.literal("")).default(""),
      api_key: z.string().default(""),
      model: z.string().default("google/gemini-3.1-flash-image-preview"),
    }),
  pdf_engine: z.string().default(""),
  pdf_max_bytes: z.number().positive().default(25 * 1024 * 1024),
  perplexity_api_key: z.string().optional(),
  perplexity_base_url: z.string().url().default("https://api.perplexity.ai/v1"),
  owner: section({
      name: z.string().default(""),
      tag: z.string().default(""),
    }),
});

export type LlmConfig = z.infer<typeof llmConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    openai_key: string;
    base_url: string;
    models: ModelEntry[];
    default_model_id: string;
    max_completion_tokens: number;
    use_chat_completions: boolean;
    image: { base_url: string; api_key: string; model: string };
    pdf_engine: string;
    pdf_max_bytes: number;
    perplexity_api_key?: string;
    perplexity_base_url: string;
    owner: { name: string; tag: string };
  }
}