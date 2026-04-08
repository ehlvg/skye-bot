// Must be set before any module that calls getDb() is executed
process.env.DB_PATH = ":memory:";

import { test, expect, describe, beforeEach } from "bun:test";
import {
  getChatConfig,
  setChatApiKey,
  setChatBaseUrl,
  resetChatApiKey,
  resetChatBaseUrl,
} from "../chatConfig.js";

const CHAT = 77;

beforeEach(async () => {
  await resetChatApiKey(CHAT);
  await resetChatBaseUrl(CHAT);
});

describe("getChatConfig", () => {
  test("returns empty object for unknown chatId", () => {
    expect(getChatConfig(9999)).toEqual({});
  });
});

describe("setChatApiKey", () => {
  test("stores and retrieves an API key", async () => {
    await setChatApiKey(CHAT, "sk-test-123");
    expect(getChatConfig(CHAT).apiKey).toBe("sk-test-123");
  });

  test("overwrites an existing API key", async () => {
    await setChatApiKey(CHAT, "sk-old");
    await setChatApiKey(CHAT, "sk-new");
    expect(getChatConfig(CHAT).apiKey).toBe("sk-new");
  });
});

describe("setChatBaseUrl", () => {
  test("stores and retrieves a base URL", async () => {
    await setChatBaseUrl(CHAT, "https://example.com/v1");
    expect(getChatConfig(CHAT).baseUrl).toBe("https://example.com/v1");
  });
});

describe("resetChatApiKey", () => {
  test("removes the API key", async () => {
    await setChatApiKey(CHAT, "sk-to-remove");
    await resetChatApiKey(CHAT);
    expect(getChatConfig(CHAT).apiKey).toBeUndefined();
  });

  test("cleans up the row when both fields are null", async () => {
    await setChatApiKey(CHAT, "sk-only");
    await resetChatApiKey(CHAT);
    expect(getChatConfig(CHAT)).toEqual({});
  });

  test("preserves baseUrl when only apiKey is reset", async () => {
    await setChatApiKey(CHAT, "sk-key");
    await setChatBaseUrl(CHAT, "https://my.api/v1");
    await resetChatApiKey(CHAT);
    const cfg = getChatConfig(CHAT);
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.baseUrl).toBe("https://my.api/v1");
  });
});

describe("resetChatBaseUrl", () => {
  test("removes the base URL", async () => {
    await setChatBaseUrl(CHAT, "https://example.com/v1");
    await resetChatBaseUrl(CHAT);
    expect(getChatConfig(CHAT).baseUrl).toBeUndefined();
  });

  test("preserves apiKey when only baseUrl is reset", async () => {
    await setChatApiKey(CHAT, "sk-keep");
    await setChatBaseUrl(CHAT, "https://drop.me/v1");
    await resetChatBaseUrl(CHAT);
    const cfg = getChatConfig(CHAT);
    expect(cfg.apiKey).toBe("sk-keep");
    expect(cfg.baseUrl).toBeUndefined();
  });
});
