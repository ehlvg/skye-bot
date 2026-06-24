import { test, expect, describe } from "vitest";
import {
  formatLogEntry,
  logMessage,
  getChatContext,
} from "../modules/chatLog/service.js";
import type { LogEntry } from "../modules/chatLog/service.js";

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

  test("stores messages without error", () => {
    for (let i = 0; i < 12; i++) {
      logMessage(CHAT, entry(`msg ${i}`));
    }
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