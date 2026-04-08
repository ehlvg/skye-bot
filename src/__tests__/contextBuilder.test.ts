import { test, expect, describe } from "bun:test";
import { buildContext } from "../contextBuilder.js";

describe("buildContext", () => {
  const makeMessages = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ role: "user", content: `msg ${i}` }));

  test("returns all messages when under the 20-message limit", () => {
    const msgs = makeMessages(10);
    expect(buildContext(msgs)).toHaveLength(10);
  });

  test("returns last 20 messages when over the limit", () => {
    const msgs = makeMessages(30);
    const result = buildContext(msgs);
    expect(result).toHaveLength(20);
    expect(result[0].content).toBe("msg 10");
    expect(result[19].content).toBe("msg 29");
  });

  test("returns all messages when exactly 20", () => {
    const msgs = makeMessages(20);
    expect(buildContext(msgs)).toHaveLength(20);
  });

  test("handles empty array", () => {
    expect(buildContext([])).toHaveLength(0);
  });
});
