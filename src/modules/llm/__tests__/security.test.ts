import { describe, expect, it } from "vitest";
import { llmEnvSchema } from "../env.js";

describe("LLM cost boundary", () => {
  it("caps completion tokens at 10,000", () => {
    expect(() =>
      llmEnvSchema.parse({ OPENAI_KEY: "test", MAX_COMPLETION_TOKENS: 10_001 })
    ).toThrow();
    expect(llmEnvSchema.parse({ OPENAI_KEY: "test" }).MAX_COMPLETION_TOKENS).toBe(500);
  });
});
