import { describe, expect, test, vi } from "vitest";
import {
  formatToolConfirmation,
  TOOL_CONFIRMATION_CALLBACK_PATTERN,
  ToolConfirmationStore,
} from "../toolConfirmation.js";

describe("tool confirmations", () => {
  test("can only be consumed once by the requesting user in the same chat", () => {
    const store = new ToolConfirmationStore(60_000);
    const execute = vi.fn(async () => "done");
    const pending = store.create(
      {
        chatId: -100,
        threadId: 7,
        userId: 42,
        toolName: "danger",
        args: {},
        isMcp: true,
        execute,
      },
      1_000
    );

    expect(store.consume(pending.id, -101, 42, 7, 2_000).status).toBe("forbidden");
    expect(store.consume(pending.id, -100, 43, 7, 2_000).status).toBe("forbidden");
    expect(store.consume(pending.id, -100, 42, 8, 2_000).status).toBe("forbidden");
    expect(store.consume(pending.id, -100, 42, 7, 2_000).status).toBe("ok");
    expect(store.consume(pending.id, -100, 42, 7, 2_000).status).toBe("not_found");
  });

  test("fails closed after expiration", () => {
    const store = new ToolConfirmationStore(100);
    const pending = store.create(
      {
        chatId: 1,
        userId: 1,
        toolName: "danger",
        args: {},
        isMcp: false,
        execute: async () => "done",
      },
      1_000
    );

    expect(store.consume(pending.id, 1, 1, undefined, 1_100).status).toBe("not_found");
  });

  test("hides secrets and produces callback-safe identifiers", () => {
    const store = new ToolConfirmationStore();
    const pending = store.create({
      chatId: 1,
      userId: 1,
      toolName: "deploy",
      args: {
        api_key: "super-secret",
        target: "production",
        optional: undefined,
        config: { authorization: "nested-secret" },
      },
      isMcp: true,
      execute: async () => "done",
    });
    const text = formatToolConfirmation(pending.toolName, pending.args, pending.isMcp);

    expect(text).not.toContain("super-secret");
    expect(text).not.toContain("nested-secret");
    expect(text).toContain("[hidden]");
    expect(text).toContain("optional: undefined");
    expect(`tool_confirm:allow:${pending.id}`.length).toBeLessThanOrEqual(64);
    expect(TOOL_CONFIRMATION_CALLBACK_PATTERN.test(`tool_confirm:allow:${pending.id}`)).toBe(true);
  });
});
