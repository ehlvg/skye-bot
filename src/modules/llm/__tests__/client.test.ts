import { describe, expect, test } from "vitest";
import { adaptChatCompletionStream } from "../client.js";

describe("chat completions streaming", () => {
  test("captures usage when the final chunk also contains a delta", async () => {
    async function* chunks() {
      yield {
        choices: [{ delta: { content: "OK", role: "assistant" }, finish_reason: null }],
        usage: null,
      };
      yield {
        choices: [{ delta: { content: "", role: "assistant" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 16, completion_tokens: 2, total_tokens: 18 },
      };
    }

    const response = await adaptChatCompletionStream(Promise.resolve(chunks())).finalResponse();

    expect(response.usage).toEqual({ promptTokens: 16, completionTokens: 2 });
  });
});
