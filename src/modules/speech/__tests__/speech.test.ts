import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { transcodeAudio } from "../transcode.js";
import {
  buildProvider,
  speechModule,
} from "../index.js";
import { YandexSpeechProvider } from "../providers/yandex.js";
import { OpenRouterSpeechProvider } from "../providers/openrouter.js";

function ffmpegSineMp3(seconds = 0.4): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath!, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=440:duration=${seconds}`,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "64k",
      "-f",
      "mp3",
      "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c: Buffer) => chunks.push(c));
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg exit ${code}`))
    );
  });
}



describe("speech transcodeAudio", () => {
  it("converts mp3 → ogg opus (OggS magic header)", async () => {
    const mp3 = await ffmpegSineMp3(0.4);
    const out = await transcodeAudio(mp3, "oggopus");
    expect(out.length).toBeGreaterThan(0);
    expect(out.subarray(0, 4).toString("ascii")).toBe("OggS");
  });

  it("converts ogg opus → mp3", async () => {
    const mp3 = await ffmpegSineMp3(0.4);
    const ogg = await transcodeAudio(mp3, "oggopus");
    const back = await transcodeAudio(ogg, "mp3");
    expect(back.length).toBeGreaterThan(0);
  });
});

describe("speech module provider selection", () => {
  it("builds yandex provider by default", () => {
    const p = buildProvider({
      VOICE_PROVIDER: "yandex",
      YC_API_KEY: "key",
      YC_FOLDER_ID: "folder",
      YC_TTS_VOICE: "jane",
    });
    expect(p).toBeInstanceOf(YandexSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
    expect(p.isTtsAvailable()).toBe(true);
  });

  it("disables yandex when api key is empty", () => {
    const p = buildProvider({ VOICE_PROVIDER: "yandex", YC_API_KEY: "" });
    expect(p.isSttAvailable()).toBe(false);
    expect(p.isTtsAvailable()).toBe(false);
  });

  it("builds openrouter provider with explicit key", () => {
    const p = buildProvider({
      VOICE_PROVIDER: "openrouter",
      VOICE_OPENROUTER_API_KEY: "or-key",
      VOICE_OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
      VOICE_OPENROUTER_STT_MODEL: "openai/whisper-1",
      VOICE_OPENROUTER_TTS_MODEL: "openai/tts-1",
    });
    expect(p).toBeInstanceOf(OpenRouterSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
    expect(p.isTtsAvailable()).toBe(true);
  });

  it("openrouter falls back to OPENAI_KEY when voice key is empty", () => {
    const p = buildProvider({
      VOICE_PROVIDER: "openrouter",
      VOICE_OPENROUTER_API_KEY: "",
      OPENAI_KEY: "sk-fallback",
      VOICE_OPENROUTER_STT_MODEL: "openai/whisper-1",
      VOICE_OPENROUTER_TTS_MODEL: "openai/tts-1",
    });
    expect(p).toBeInstanceOf(OpenRouterSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
  });

  it("openrouter disabled when no key and no model", () => {
    const p = buildProvider({
      VOICE_PROVIDER: "openrouter",
      VOICE_OPENROUTER_API_KEY: "",
      OPENAI_KEY: "",
      VOICE_OPENROUTER_STT_MODEL: "",
      VOICE_OPENROUTER_TTS_MODEL: "",
    });
    expect(p.isSttAvailable()).toBe(false);
    expect(p.isTtsAvailable()).toBe(false);
  });

  it("module init returns a SpeechService", () => {
    const ctx = {
      config: { VOICE_PROVIDER: "yandex", YC_API_KEY: "k" },
    } as never;
    const result = speechModule.init?.(ctx) as { service?: { isSttAvailable: () => boolean } } | undefined;
    expect(result?.service).toBeDefined();
    expect(result?.service?.isSttAvailable()).toBe(true);
  });
});