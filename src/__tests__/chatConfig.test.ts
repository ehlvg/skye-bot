import { test, expect, describe, beforeEach } from "vitest";
import {
  chatConfigService,
  getChatConfig,
  getChatThreadAgent,
  getChatThreadPrompt,
  resetChatThreadAgent,
  resetChatThreadPrompt,
  setChatThreadAgent,
  setChatThreadPrompt,
  setChatVoiceMode,
} from "../modules/chatConfig/service.js";
import { getDb } from "../core/db.js";

const CHAT = 77;

beforeEach(() => {
  getDb().prepare("DELETE FROM chat_configs WHERE chat_id = ?").run(CHAT);
  getDb().prepare("DELETE FROM chat_thread_prompts WHERE chat_id = ?").run(CHAT);
  getDb().prepare("DELETE FROM chat_thread_agents WHERE chat_id = ?").run(CHAT);
});

describe("thread-scoped agents", () => {
  test("keeps the selected agent isolated between topics", () => {
    setChatThreadAgent(CHAT, undefined, "researcher");
    setChatThreadAgent(CHAT, 10, "analyst");

    expect(getChatThreadAgent(CHAT)).toBe("researcher");
    expect(getChatThreadAgent(CHAT, 10)).toBe("analyst");
    expect(getChatThreadAgent(CHAT, 20)).toBeUndefined();
  });

  test("resets only the current topic agent", () => {
    chatConfigService.setAgent(CHAT, 10, "researcher");
    chatConfigService.setAgent(CHAT, 20, "analyst");

    expect(resetChatThreadAgent(CHAT, 20)).toBe(true);
    expect(resetChatThreadAgent(CHAT, 20)).toBe(false);
    expect(chatConfigService.getAgent(CHAT, 10)).toBe("researcher");
  });
});

describe("getChatConfig", () => {
  test("returns defaults for an unknown chat", () => {
    expect(getChatConfig(9999)).toEqual({ voiceMode: false });
  });
});

describe("setChatVoiceMode", () => {
  test("stores and toggles voice mode", () => {
    setChatVoiceMode(CHAT, true);
    expect(getChatConfig(CHAT).voiceMode).toBe(true);
    setChatVoiceMode(CHAT, false);
    expect(getChatConfig(CHAT).voiceMode).toBe(false);
  });

  test("is exposed on the ChatConfigService", () => {
    chatConfigService.setVoiceMode(CHAT, true);
    expect(chatConfigService.get(CHAT).voiceMode).toBe(true);
  });
});

describe("thread-scoped custom prompts", () => {
  test("keeps prompts isolated between topics and the main chat", () => {
    setChatThreadPrompt(CHAT, undefined, "main prompt");
    setChatThreadPrompt(CHAT, 10, "topic ten");
    setChatThreadPrompt(CHAT, 20, "topic twenty");

    expect(getChatThreadPrompt(CHAT)).toBe("main prompt");
    expect(getChatThreadPrompt(CHAT, 10)).toBe("topic ten");
    expect(getChatThreadPrompt(CHAT, 20)).toBe("topic twenty");
    expect(getChatThreadPrompt(CHAT, 30)).toBeUndefined();
  });

  test("uses chat and topic scope rather than the user who set it", () => {
    chatConfigService.setPrompt(CHAT, 42, "shared group prompt");

    expect(chatConfigService.getPrompt(CHAT, 42)).toBe("shared group prompt");
  });

  test("reset removes only the current topic prompt", () => {
    setChatThreadPrompt(CHAT, 10, "keep separate");
    setChatThreadPrompt(CHAT, 20, "remove me");

    expect(resetChatThreadPrompt(CHAT, 20)).toBe(true);
    expect(resetChatThreadPrompt(CHAT, 20)).toBe(false);
    expect(getChatThreadPrompt(CHAT, 10)).toBe("keep separate");
  });
});
