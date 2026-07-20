import { describe, expect, test, vi } from "vitest";
import type { ChatLogService, GroupMessage } from "../../chatLog/service.js";
import type { LlmClient, LlmResponse } from "../../llm/client.js";
import type { MemoryService } from "../../memory/service.js";
import { ProactiveService } from "../service.js";

const messages: GroupMessage[] = [
  {
    messageId: 10,
    sender: "Alice",
    timestamp: "12:00",
    type: "text",
    content: "that was surprisingly good",
  },
];

function response(output_text: string): LlmResponse {
  return { output_text, output: [] };
}

function makeService(ask: ReturnType<typeof vi.fn>) {
  return new ProactiveService(
    {
      llm: { ask } as unknown as LlmClient,
      chatLog: {
        recentGroupMessages: vi.fn(() => messages),
      } as unknown as ChatLogService,
      memory: { context: vi.fn(() => []) } as unknown as MemoryService,
    },
    {
      enabled: true,
      probability: 1,
      warmup: 1,
      minIntervalSec: 180,
      contextSize: 20,
    }
  );
}

describe("ProactiveService", () => {
  test("allows only one decision in flight per topic", async () => {
    let resolve!: (value: LlmResponse) => void;
    const ask = vi.fn(
      () =>
        new Promise<LlmResponse>((done) => {
          resolve = done;
        })
    );
    const service = makeService(ask);

    const first = service.maybeReact(1, 10, "Group", undefined, 5);
    const concurrent = await service.maybeReact(1, 10, "Group", undefined, 5);

    expect(concurrent).toBeNull();
    expect(ask).toHaveBeenCalledOnce();

    resolve(
      response(
        JSON.stringify({
          react: true,
          target_message_id: 10,
          kind: "emoji",
          emoji: "👍",
        })
      )
    );
    await expect(first).resolves.toMatchObject({ kind: "emoji", targetMessageId: 10 });
  });

  test("rejects a target outside the candidate messages", async () => {
    const ask = vi.fn().mockResolvedValue(
      response(
        JSON.stringify({
          react: true,
          target_message_id: 999,
          kind: "emoji",
          emoji: "👍",
        })
      )
    );
    const service = makeService(ask);

    await expect(service.maybeReact(1, 10, "Group")).resolves.toBeNull();
  });

  test("ignores text replies from the model", async () => {
    const ask = vi.fn().mockResolvedValue(
      response(
        JSON.stringify({
          react: true,
          target_message_id: 10,
          kind: "text",
          text: "I have something to add",
        })
      )
    );
    const service = makeService(ask);

    await expect(service.maybeReact(1, 10, "Group")).resolves.toBeNull();
  });
});
