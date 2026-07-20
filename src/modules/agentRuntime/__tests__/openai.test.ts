import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "../../llm/client.js";
import type { ModelEntry } from "../../llm/config.js";
import { hostedToolsForModel, providerDataForModel, toAgentInput } from "../openai.js";

describe("Agents SDK input conversion", () => {
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
