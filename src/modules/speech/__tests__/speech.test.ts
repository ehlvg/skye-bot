import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import { transcodeAudio } from "../transcode.js";
import { buildProvider, speechModule } from "../index.js";
import { YandexSpeechProvider } from "../providers/yandex.js";
import { OpenRouterSpeechProvider } from "../providers/openrouter.js";
import type { SkyeConfig } from "../../../core/config.js";

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

function makeConfig(overrides: Partial<SkyeConfig> = {}): SkyeConfig {
  return {
    openai_key: "",
    base_url: "https://openrouter.ai/api/v1",
    models: [],
    default_model_id: "sydney",
    max_completion_tokens: 500,
    use_chat_completions: false,
    image: { base_url: "", api_key: "", model: "" },
    pdf_engine: "",
    pdf_max_bytes: 25 * 1024 * 1024,
    perplexity_base_url: "https://api.perplexity.ai/v1",
    owner: { name: "", tag: "" },
    voice: {
      provider: "yandex",
      yc_api_key: "",
      yc_folder_id: "",
      yc_tts_voice: "jane",
      yc_tts_emotion: "neutral",
      yc_tts_lang: "ru-RU",
      yc_tts_speed: 1.0,
      openrouter: {
        api_key: "",
        base_url: "https://openrouter.ai/api/v1",
        stt_model: "nvidia/parakeet-tdt-0.6b-v3",
        tts_model: "google/gemini-3.1-flash-tts-preview",
        tts_voice: "Aoede",
        tts_format: "mp3",
        pcm_sample_rate: 48000,
        pcm_channels: 1,
        stt_format: "mp3",
        stt_language: "",
        referer: "",
        title: "",
      },
      tinfoil: {
        api_key: "",
        base_url: "",
        stt_model: "whisper-large-v3-turbo",
        tts_model: "qwen3-tts",
        tts_voice: "vivian",
        tts_instruct: "",
        stt_format: "mp3",
        stt_language: "",
      },
    },
    ...overrides,
  } as SkyeConfig;
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
    const p = buildProvider(
      makeConfig({
        voice: {
          ...makeConfig().voice,
          yc_api_key: "key",
          yc_folder_id: "folder",
          yc_tts_voice: "jane",
        },
      })
    );
    expect(p).toBeInstanceOf(YandexSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
    expect(p.isTtsAvailable()).toBe(true);
  });

  it("disables yandex when api key is empty", () => {
    const p = buildProvider(makeConfig());
    expect(p.isSttAvailable()).toBe(false);
    expect(p.isTtsAvailable()).toBe(false);
  });

  it("builds openrouter provider with explicit key", () => {
    const p = buildProvider(
      makeConfig({
        openai_key: "",
        voice: {
          ...makeConfig().voice,
          provider: "openrouter",
          openrouter: {
            ...makeConfig().voice.openrouter,
            api_key: "or-key",
            base_url: "https://openrouter.ai/api/v1",
            stt_model: "openai/whisper-1",
            tts_model: "openai/tts-1",
          },
        },
      })
    );
    expect(p).toBeInstanceOf(OpenRouterSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
    expect(p.isTtsAvailable()).toBe(true);
  });

  it("openrouter falls back to openai_key when voice key is empty", () => {
    const p = buildProvider(
      makeConfig({
        openai_key: "sk-fallback",
        voice: {
          ...makeConfig().voice,
          provider: "openrouter",
          openrouter: {
            ...makeConfig().voice.openrouter,
            api_key: "",
            stt_model: "openai/whisper-1",
            tts_model: "openai/tts-1",
          },
        },
      })
    );
    expect(p).toBeInstanceOf(OpenRouterSpeechProvider);
    expect(p.isSttAvailable()).toBe(true);
  });

  it("openrouter disabled when no key and no model", () => {
    const p = buildProvider(
      makeConfig({
        openai_key: "",
        voice: {
          ...makeConfig().voice,
          provider: "openrouter",
          openrouter: {
            ...makeConfig().voice.openrouter,
            api_key: "",
            stt_model: "",
            tts_model: "",
          },
        },
      })
    );
    expect(p.isSttAvailable()).toBe(false);
    expect(p.isTtsAvailable()).toBe(false);
  });

  it("module init returns a SpeechService", () => {
    const ctx = {
      config: makeConfig({ voice: { ...makeConfig().voice, yc_api_key: "k" } }),
    } as never;
    const result = speechModule.init?.(ctx) as {
      service?: { isSttAvailable: () => boolean };
    } | undefined;
    expect(result?.service).toBeDefined();
    expect(result?.service?.isSttAvailable()).toBe(true);
  });
});