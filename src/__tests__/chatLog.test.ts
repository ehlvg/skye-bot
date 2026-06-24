import { test, expect, describe } from "vitest";
import {
  formatLogEntry,
  logMessage,
  getChatContext,
  groupMessagesSince,
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

describe("groupMessagesSince", () => {
  const CHAT = 1004;

  test("returns messages within the time window", () => {
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 30 * 60 * 1000);
    const now = new Date();

    logMessage(CHAT, { ...entry("old msg"), timestamp: old.toISOString() });
    logMessage(CHAT, { ...entry("recent msg"), timestamp: recent.toISOString() });

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const msgs = groupMessagesSince(CHAT, since, now);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("recent msg");
  });

  test("returns empty for a chat with no messages in window", () => {
    const msgs = groupMessagesSince(99999, new Date(Date.now() - 60 * 1000));
    expect(msgs).toHaveLength(0);
  });
});