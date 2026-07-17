import type { SkyeModule } from "../../core/module.js";
import { LlmClient } from "./client.js";
import { llmConfigSchema, type ModelEntry } from "./config.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    llm: LlmClient;
  }
}

export const llmModule: SkyeModule = {
  name: "llm",
  configSchema: llmConfigSchema,
  init(ctx) {
    const c = ctx.config;
    const client = new LlmClient({
      apiKey: c.openai_key,
      baseUrl: c.base_url,
      models: c.models as readonly ModelEntry[],
      defaultModelId: c.default_model_id,
      maxCompletionTokens: c.max_completion_tokens,
      useChatCompletions: c.use_chat_completions,
      imageApiKey: c.image.api_key,
      imageBaseUrl: c.image.base_url,
      imageModel: c.image.model,
      pdfEngine: c.pdf_engine,
      pdfMaxBytes: c.pdf_max_bytes,
      perplexityApiKey: c.perplexity_api_key,
      perplexityBaseUrl: c.perplexity_base_url,
    });
    return { service: client };
  },
};
