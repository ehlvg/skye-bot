import { test, expect, describe } from "vitest";
import {
  formatLogEntry,
  logMessage,
  getChatContext,
  groupMessagesSince,
  recentGroupMessages,
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

  test("does not mix messages from different topics", () => {
    logMessage(CHAT, entry("topic one"), "Test Group", 101);
    logMessage(CHAT, entry("topic two"), "Test Group", 202);

    expect(getChatContext(CHAT, 101)?.recentLog).toContain("topic one");
    expect(getChatContext(CHAT, 101)?.recentLog).not.toContain("topic two");
    expect(getChatContext(CHAT, 202)?.recentLog).toContain("topic two");
    expect(getChatContext(CHAT, 202)?.recentLog).not.toContain("topic one");
  });

  test("keeps proactive candidate messages inside the current topic", () => {
    logMessage(CHAT, entry("candidate one"), "Test Group", 301);
    logMessage(CHAT, entry("candidate two"), "Test Group", 302);

    expect(recentGroupMessages(CHAT, 30, 301).map((message) => message.content)).toContain(
      "candidate one"
    );
    expect(recentGroupMessages(CHAT, 30, 301).map((message) => message.content)).not.toContain(
      "candidate two"
    );
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

  test("can restrict the time window to one topic", () => {
    const recent = new Date(Date.now() - 30 * 1000).toISOString();
    logMessage(CHAT, { ...entry("first topic"), timestamp: recent }, "Test Group", 11);
    logMessage(CHAT, { ...entry("second topic"), timestamp: recent }, "Test Group", 22);

    const msgs = groupMessagesSince(CHAT, new Date(Date.now() - 60 * 1000), new Date(), 11);
    expect(msgs.map((message) => message.content)).toEqual(["first topic"]);
  });
});
