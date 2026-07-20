import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../../../core/module.js";
import type { LlmResponse, LlmStream, ResponseInputItem } from "../../llm/client.js";
import { MAX_TOOL_ITERATIONS, runChatLoop, type ChatLoopDeps } from "../chat.js";

type OfferedTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

describe("runChatLoop", () => {
  it("allows 20 tool iterations and then requests a final answer with their outputs", async () => {
    const responses: LlmResponse[] = Array.from({ length: MAX_TOOL_ITERATIONS }, (_, index) => ({
      output_text: "",
      output: [
        {
          type: "function_call",
          call_id: `call-${index}`,
          name: "calculate",
          arguments: "{}",
        },
      ],
    }));
    responses.push({ output_text: "Final answer", output: [] });

    const requests: Array<{
      instructions: string;
      input: ResponseInputItem[];
      tools?: OfferedTool[];
    }> = [];
    let executions = 0;
    const calculate: ToolDefinition = {
      name: "calculate",
      description: "Calculate a value",
      parameters: { type: "object", properties: {} },
      execute: () => {
        executions += 1;
        return String(executions);
      },
    };

    const deps = {
      llm: {
        resolveModel: () => ({
          id: "test",
          name: "Test",
          model: "test/model",
          multiplier: 1,
          contextWindow: 128_000,
        }),
        askStream: (
          instructions: string,
          input: ResponseInputItem[],
          tools?: OfferedTool[]
        ): LlmStream => {
          requests.push({ instructions, input: [...input], tools });
          const response = responses.shift();
          if (!response) throw new Error("Unexpected LLM request");
          return {
            on: () => undefined,
            finalResponse: async () => response,
            abort: async () => undefined,
          };
        },
      },
      connectors: {
        toolsFor: async () => [],
        isConnectorTool: () => false,
      },
      memory: { context: () => [] },
      chatLog: {
        context: () => undefined,
        appendConversation: () => undefined,
      },
      userConfig: { get: () => ({}) },
      chatConfig: { getPrompt: () => undefined },
      builtinTools: [calculate],
    } as unknown as ChatLoopDeps;

    const result = await runChatLoop(deps, { chatId: 1, chatType: "private", userId: 1 }, [
      { type: "message", role: "user", content: "Calculate" },
    ]);

    expect(result).toBe("Final answer");
    expect(executions).toBe(MAX_TOOL_ITERATIONS);
    expect(requests).toHaveLength(MAX_TOOL_ITERATIONS + 1);
    expect(
      requests.slice(0, MAX_TOOL_ITERATIONS).every((request) => request.tools?.length === 1)
    ).toBe(true);
    expect(requests.at(-1)?.tools).toBeUndefined();
    expect(requests.at(-1)?.instructions).toContain("Do not call any more tools");
    expect(
      requests
        .at(-1)
        ?.input.filter((item) => (item as { type?: string }).type === "function_call_output")
    ).toHaveLength(MAX_TOOL_ITERATIONS);
  });
});
