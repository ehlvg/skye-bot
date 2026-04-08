import { test, expect, describe } from "bun:test";
import { buildSystemMessage, SYSTEM_PROMPT } from "../prompt.js";
import type { MemoryEntry } from "../memory.js";

const makeMemory = (id: string, content: string): MemoryEntry => ({
  id,
  content,
  createdAt: new Date().toISOString(),
});

describe("buildSystemMessage", () => {
  test("returns a system role message", () => {
    const msg = buildSystemMessage([]);
    expect(msg.role).toBe("system");
  });

  test("includes the base system prompt", () => {
    const msg = buildSystemMessage([]);
    expect(msg.content).toContain(SYSTEM_PROMPT.trim().slice(0, 30));
  });

  test("includes memory entries when present", () => {
    const msg = buildSystemMessage([makeMemory("mem_abc", "user likes cats")]);
    expect(msg.content).toContain("[mem_abc] user likes cats");
  });

  test("does not include memory section header when no memories", () => {
    const msg = buildSystemMessage([]);
    expect(msg.content).not.toContain("Saved memories for this chat");
  });

  test("includes chat context when provided", () => {
    const msg = buildSystemMessage([], {
      chatTitle: "Dev Team",
      summary: "discussed deployment",
      recentLog: "Alice: ready to ship",
    });
    expect(msg.content).toContain('"Dev Team"');
    expect(msg.content).toContain("discussed deployment");
    expect(msg.content).toContain("Alice: ready to ship");
  });

  test("omits older summary section when summary is empty", () => {
    const msg = buildSystemMessage([], {
      chatTitle: "Dev Team",
      summary: "",
      recentLog: "Alice: hi",
    });
    expect(msg.content).not.toContain("Older conversation summary");
  });

  test("includes multiple memories in order", () => {
    const mems = [makeMemory("mem_1", "fact one"), makeMemory("mem_2", "fact two")];
    const content = buildSystemMessage(mems).content;
    const pos1 = content.indexOf("[mem_1]");
    const pos2 = content.indexOf("[mem_2]");
    expect(pos1).toBeGreaterThan(-1);
    expect(pos2).toBeGreaterThan(pos1);
  });
});
