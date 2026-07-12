import { describe, expect, it } from "vitest";
import { llmEnvSchema } from "../env.js";

describe("LLM cost boundary", () => {
  it("allows large positive completion limits", () => {
    expect(
      llmEnvSchema.parse({ OPENAI_KEY: "test", MAX_COMPLETION_TOKENS: 100_000 })
        .MAX_COMPLETION_TOKENS
    ).toBe(100_000);
    expect(() => llmEnvSchema.parse({ OPENAI_KEY: "test", MAX_COMPLETION_TOKENS: 0 })).toThrow();
    expect(llmEnvSchema.parse({ OPENAI_KEY: "test" }).MAX_COMPLETION_TOKENS).toBe(500);
  });
});
