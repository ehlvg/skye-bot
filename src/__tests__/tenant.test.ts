import { describe, expect, test } from "vitest";
import type { Context } from "grammy";
import { tenantFromGrammy, threadKey } from "../core/tenant.js";

describe("Telegram topic tenant scope", () => {
  test("reads a private topic from a message update", () => {
    const ctx = {
      chat: { id: 100, type: "private" },
      from: { id: 100, first_name: "Alice", is_bot: false },
      msg: { message_thread_id: 7 },
    } as unknown as Context;

    const tenant = tenantFromGrammy(ctx);
    expect(tenant.threadId).toBe(7);
    expect(threadKey(tenant)).toBe("100:7");
  });

  test("retains topic scope for callback-query contexts", () => {
    const ctx = {
      chat: { id: -100200, type: "supergroup" },
      from: { id: 300, first_name: "Bob", is_bot: false },
      msg: { message_thread_id: 55 },
    } as unknown as Context;

    expect(tenantFromGrammy(ctx).threadId).toBe(55);
  });
});
