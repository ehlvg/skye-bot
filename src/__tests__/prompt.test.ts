import { test, expect, describe } from "vitest";
import { buildSystemPrompt, SYSTEM_PROMPT } from "../modules/llm/prompt.js";
import type { MemoryEntry } from "../modules/memory/service.js";

const makeMemory = (id: string, content: string): MemoryEntry => ({
  id,
  content,
  createdAt: new Date().toISOString(),
});

describe("buildSystemPrompt", () => {
  test("returns a string", () => {
    const prompt = buildSystemPrompt([]);
    expect(typeof prompt).toBe("string");
  });

  test("includes the base system prompt", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain(SYSTEM_PROMPT.trim().slice(0, 30));
  });

  test("includes memory entries when present", () => {
    const prompt = buildSystemPrompt([makeMemory("mem_abc", "user likes cats")]);
    expect(prompt).toContain("[mem_abc] user likes cats");
  });

  test("does not include memory section header when no memories", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain("Saved memories for this chat");
  });

  test("includes chat context when provided", () => {
    const prompt = buildSystemPrompt([], {
      chatTitle: "Dev Team",
      recentLog: "Alice: ready to ship",
    });
    expect(prompt).toContain('"Dev Team"');
    expect(prompt).toContain("Alice: ready to ship");
  });

  test("omits older summary section when no summary field exists", () => {
    const prompt = buildSystemPrompt([], {
      chatTitle: "Dev Team",
      recentLog: "Alice: hi",
    });
    expect(prompt).not.toContain("Older conversation summary");
  });

  test("includes multiple memories in order", () => {
    const mems = [makeMemory("mem_1", "fact one"), makeMemory("mem_2", "fact two")];
    const content = buildSystemPrompt(mems);
    const pos1 = content.indexOf("[mem_1]");
    const pos2 = content.indexOf("[mem_2]");
    expect(pos1).toBeGreaterThan(-1);
    expect(pos2).toBeGreaterThan(pos1);
  });

  test("includes sandbox section when enabled", () => {
    const prompt = buildSystemPrompt([], undefined, undefined, undefined, true);
    expect(prompt).toContain("Vercel Sandbox");
    expect(prompt).toContain("sandbox_run_command");
  });

  test("omits sandbox section when disabled", () => {
    const prompt = buildSystemPrompt([], undefined, undefined, undefined, false);
    expect(prompt).not.toContain("Vercel Sandbox");
  });

  test("includes reminders section when enabled", () => {
    const prompt = buildSystemPrompt(
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    expect(prompt).toContain("## Reminders");
    expect(prompt).toContain("set_reminder");
  });

  test("omits reminders section when not enabled", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain("## Reminders");
  });

  test("includes current ISO datetime in chat context", () => {
    const prompt = buildSystemPrompt([], {
      chatTitle: "Test",
      recentLog: "hi",
    });
    expect(prompt).toContain("Current ISO datetime");
  });

  test("includes owner section when owner is provided", () => {
    const prompt = buildSystemPrompt(
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { name: "Melissa", tag: "miss_sterling" }
    );
    expect(prompt).toContain("Melissa");
    expect(prompt).toContain("@miss_sterling");
    expect(prompt).toContain("Bot Owner");
  });

  test("includes channel section when enabled", () => {
    const prompt = buildSystemPrompt(
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      true
    );
    expect(prompt).toContain("## Channel Management");
    expect(prompt).toContain("post_to_channel");
  });

  test("omits channel section when not enabled", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain("## Channel Management");
  });

  test("omits owner section when owner is absent", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).not.toContain("Bot Owner");
  });

  test("uses feminine identity", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("Female");
    expect(prompt).toContain("feminine");
  });

  test("includes self-awareness about subscription and reactions", () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain("Skye Plus");
    expect(prompt).toContain("reaction");
  });
});
