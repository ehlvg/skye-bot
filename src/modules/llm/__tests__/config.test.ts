import { describe, expect, it } from "vitest";
import { llmConfigSchema } from "../config.js";

describe("LLM cost boundary", () => {
  it("allows large positive completion limits", () => {
    expect(
      llmConfigSchema.parse({ openai_key: "test", max_completion_tokens: 100_000 })
        .max_completion_tokens
    ).toBe(100_000);
    expect(() =>
      llmConfigSchema.parse({ openai_key: "test", max_completion_tokens: 0 })
    ).toThrow();
    expect(llmConfigSchema.parse({ openai_key: "test" }).max_completion_tokens).toBe(500);
  });
});