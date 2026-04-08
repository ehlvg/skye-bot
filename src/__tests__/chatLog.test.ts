// Must be set before any module that calls getDb() is executed
process.env.DB_PATH = ":memory:";

import { test, expect, describe } from "bun:test";
import { formatLogEntry, logMessage, getOlderEntries, getChatContext } from "../chatLog.js";
import type { LogEntry } from "../chatLog.js";

const entry = (content: string, sender = "Alice", type = "text"): LogEntry => ({
  sender,
  timestamp: "12:00",
  type,
  content,
});

describe("formatLogEntry", () => {
  test("formats a basic text entry", () => {
    const result = formatLogEntry(entry("hello"));
    expect(result).toBe("[12:00] Alice: hello");
  });

  test("includes reply-to when present", () => {
    const e: LogEntry = { ...entry("hi"), replyTo: "Bob" };
    expect(formatLogEntry(e)).toBe("[12:00] Alice (replying to Bob): hi");
  });

  test("includes type tag for non-text messages", () => {
    const e = entry("😂", "Alice", "sticker");
    expect(formatLogEntry(e)).toBe("[12:00] Alice: [sticker] 😂");
  });

  test("combines reply and type tag", () => {
    const e: LogEntry = { ...entry("📎 report.pdf", "Alice", "document"), replyTo: "Bob" };
    expect(formatLogEntry(e)).toBe("[12:00] Alice (replying to Bob): [document] 📎 report.pdf");
  });
});

describe("logMessage", () => {
  const CHAT = 1001;

  test("returns false before SUMMARIZE_INTERVAL (10) messages", () => {
    for (let i = 0; i < 9; i++) {
      expect(logMessage(CHAT, entry(`msg ${i}`))).toBe(false);
    }
  });

  test("returns true on the 10th message (summarization due)", () => {
    expect(logMessage(CHAT, entry("msg 9"))).toBe(true);
  });
});

describe("getOlderEntries", () => {
  const CHAT = 1002;

  test("returns empty array when no messages logged", () => {
    expect(getOlderEntries(CHAT)).toHaveLength(0);
  });

  test("returns entries before the last 20", () => {
    for (let i = 0; i < 25; i++) logMessage(CHAT, entry(`msg ${i}`));
    const older = getOlderEntries(CHAT);
    expect(older).toHaveLength(5);
    expect(older[0].content).toBe("msg 0");
  });
});

describe("getChatContext", () => {
  const CHAT = 1003;

  test("returns undefined for a chat with no messages", () => {
    expect(getChatContext(CHAT)).toBeUndefined();
  });

  test("returns context once messages are logged", () => {
    logMessage(CHAT, entry("hello"), "Test Group");
    const ctx = getChatContext(CHAT);
    expect(ctx).toBeDefined();
    expect(ctx!.chatTitle).toBe("Test Group");
    expect(ctx!.recentLog).toContain("hello");
  });
});
