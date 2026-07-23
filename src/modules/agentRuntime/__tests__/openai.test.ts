import {
  Agent,
  MaxTurnsExceededError,
  Runner,
  Usage,
  tool,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type StreamEvent,
} from "@openai/agents";
import { describe, expect, it, vi } from "vitest";
import type { ResponseInputItem } from "../../llm/client.js";
import type { ModelEntry } from "../../llm/config.js";
import {
  hostedToolsForModel,
  providerDataForModel,
  resolveTerminalToolUse,
  toAgentInput,
} from "../openai.js";

describe("Agents SDK input conversion", () => {
  it("ends the SDK run at a successful terminal tool instead of repeating empty turns", async () => {
    const requests: ModelRequest[] = [];
    const execute = vi.fn(async () => "Voice note prepared successfully.");
    const model = new EmptyAfterToolModel(requests);
    const voiceTool = tool({
      name: "send_voice",
      description: "Prepare a voice response",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
        required: [],
      } as never,
      strict: false,
      execute,
    });

    const loopingAgent = new Agent({ name: "looping", model, tools: [voiceTool] });
    await expect(
      new Runner({ tracingDisabled: true }).run(loopingAgent, "Speak", { maxTurns: 4 })
    ).rejects.toBeInstanceOf(MaxTurnsExceededError);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(4);
    expect(requests.slice(1).map(stableModelInput)).toEqual([
      stableModelInput(requests[1]),
      stableModelInput(requests[1]),
      stableModelInput(requests[1]),
    ]);

    requests.length = 0;
    execute.mockClear();
    const terminalAgent = new Agent({
      name: "terminal",
      model,
      tools: [voiceTool],
      toolUseBehavior: (_context, results) =>
        resolveTerminalToolUse(
          [{ name: "send_voice", terminal: true }],
          results.map((result) => result.tool.name),
          () => true
        ),
    });
    const result = await new Runner({ tracingDisabled: true }).run(terminalAgent, "Speak", {
      maxTurns: 4,
    });

    expect(result.finalOutput).toBe("");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(requests).toHaveLength(1);
  });

  it("stops only after a successful terminal tool", () => {
    const tools = [
      { name: "search", terminal: false },
      { name: "send_voice", terminal: true },
    ];

    expect(resolveTerminalToolUse(tools, ["search"], () => true)).toEqual({
      isFinalOutput: false,
      isInterrupted: undefined,
    });
    expect(resolveTerminalToolUse(tools, ["send_voice"], () => false)).toEqual({
      isFinalOutput: false,
      isInterrupted: undefined,
    });
    expect(resolveTerminalToolUse(tools, ["send_voice"], () => true)).toEqual({
      isFinalOutput: true,
      isInterrupted: undefined,
      finalOutput: "",
    });
  });

  it("converts multimodal messages and tool history", () => {
    const input = [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "Inspect this" },
          { type: "input_image", image_url: "data:image/png;base64,abc" },
          {
            type: "input_file",
            file_data: "data:text/plain;base64,SGk=",
            filename: "note.txt",
          },
        ],
      },
      {
        type: "function_call",
        call_id: "call-1",
        name: "calculate",
        arguments: '{"value":2}',
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: "4",
      },
    ] as ResponseInputItem[];

    expect(toAgentInput(input)).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "Inspect this" },
          { type: "input_image", image: "data:image/png;base64,abc" },
          {
            type: "input_file",
            file: "data:text/plain;base64,SGk=",
            filename: "note.txt",
          },
        ],
      },
      {
        type: "function_call",
        callId: "call-1",
        name: "calculate",
        arguments: '{"value":2}',
      },
      {
        type: "function_call_result",
        callId: "call-1",
        name: "calculate",
        status: "completed",
        output: "4",
      },
    ]);
  });

  it("preserves OpenRouter hosted tools, presets, and PDF parsing", () => {
    const entry: ModelEntry = {
      id: "research",
      name: "Research",
      model: "provider/model",
      multiplier: 1,
      contextWindow: 128_000,
      builtinTools: ["web_search", "fetch_url", "sandbox"],
      preset: "preset/skye",
    };
    const input = [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_file", file_data: "data:application/pdf;base64,abc" }],
      },
    ] as ResponseInputItem[];

    expect(hostedToolsForModel(entry, false)).toEqual([
      { type: "hosted_tool", name: "web_search", providerData: { type: "web_search" } },
      { type: "hosted_tool", name: "fetch_url", providerData: { type: "fetch_url" } },
      { type: "hosted_tool", name: "sandbox", providerData: { type: "sandbox" } },
    ]);
    expect(hostedToolsForModel(entry, true)).toEqual([]);
    expect(providerDataForModel(entry, input, "mistral-ocr")).toEqual({
      preset: "preset/skye",
      plugins: [{ id: "file-parser", pdf: { engine: "mistral-ocr" } }],
    });
  });
});

class EmptyAfterToolModel implements Model {
  constructor(private readonly requests: ModelRequest[]) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push(request);
    return {
      usage: new Usage({ inputTokens: 8_596, outputTokens: 4 }),
      output:
        this.requests.length === 1
          ? [
              {
                type: "function_call",
                callId: "voice-1",
                name: "send_voice",
                arguments: "{}",
                status: "completed",
              },
            ]
          : [],
    };
  }

  async *getStreamedResponse(): AsyncIterable<StreamEvent> {
    yield* [] as StreamEvent[];
    throw new Error("Streaming is not used by this test");
  }
}

function stableModelInput(request: ModelRequest): string {
  return JSON.stringify({
    input: request.input,
    systemInstructions: request.systemInstructions,
    tools: request.tools,
    outputType: request.outputType,
  });
}
