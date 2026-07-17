import { describe, expect, test, vi } from "vitest";
import type { ToolDefinition } from "../../../core/module.js";
import type { TenantContext } from "../../../core/tenant.js";
import { runChatLoop, type ChatLoopDeps, type ToolConfirmationRequest } from "../chat.js";

const tenant: TenantContext = { chatId: 10, chatType: "private", userId: 20 };

function makeDeps(
  tool: ToolDefinition,
  requestToolConfirmation?: (request: ToolConfirmationRequest) => Promise<string>
): ChatLoopDeps {
  const responses = [
    {
      output_text: "",
      output: [
        {
          type: "function_call",
          call_id: "call-1",
          name: tool.name,
          arguments: '{"command":"echo"}',
        },
      ],
    },
    { output_text: "Waiting for confirmation.", output: [] },
  ];
  return {
    llm: {
      resolveModel: () => ({
        id: "test",
        name: "Test",
        model: "test",
        multiplier: 1,
        contextWindow: 128_000,
      }),
      askStream: vi.fn(() => ({
        on: vi.fn(),
        abort: vi.fn(async () => {}),
        finalResponse: vi.fn(async () => responses.shift()!),
      })),
    },
    mcp: {
      toolsFor: () => [],
      isMcpTool: () => false,
    },
    memory: { search: () => [] },
    chatLog: { context: () => undefined, appendConversation: vi.fn() },
    userConfig: { get: () => undefined },
    builtinTools: [tool],
    requestToolConfirmation,
  } as unknown as ChatLoopDeps;
}

describe("chat tool confirmation gate", () => {
  test("defers a dangerous tool until the stored action is explicitly executed", async () => {
    const execute = vi.fn(async () => "done");
    const tool: ToolDefinition = {
      name: "dangerous_tool",
      description: "test",
      parameters: { type: "object", properties: {} },
      requiresConfirmation: true,
      execute,
    };
    let pending: ToolConfirmationRequest | undefined;
    const requestConfirmation = vi.fn(async (request: ToolConfirmationRequest) => {
      pending = request;
      return "Awaiting explicit confirmation; not executed.";
    });

    const result = await runChatLoop(makeDeps(tool, requestConfirmation), tenant, [
      { type: "message", role: "user", content: "run it" },
    ]);

    expect(result).toBe("Waiting for confirmation.");
    expect(requestConfirmation).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(pending).toBeDefined();
    await pending!.execute();
    expect(execute).toHaveBeenCalledOnce();
  });

  test("fails closed when the confirmation channel is unavailable", async () => {
    const execute = vi.fn(async () => "done");
    const tool: ToolDefinition = {
      name: "dangerous_tool",
      description: "test",
      parameters: { type: "object", properties: {} },
      requiresConfirmation: true,
      execute,
    };

    await runChatLoop(makeDeps(tool), tenant, [
      { type: "message", role: "user", content: "run it" },
    ]);

    expect(execute).not.toHaveBeenCalled();
  });
});
