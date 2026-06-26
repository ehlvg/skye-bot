import { test, expect, describe, beforeEach } from "vitest";
import { getChatConfig, setChatVoiceMode, chatConfigService } from "../modules/chatConfig/service.js";
import { getDb } from "../core/db.js";

const CHAT = 77;

beforeEach(() => {
  getDb().prepare("DELETE FROM chat_configs WHERE chat_id = ?").run(CHAT);
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