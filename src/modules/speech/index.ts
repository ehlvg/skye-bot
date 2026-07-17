import type { SkyeModule } from "../../core/module.js";
import { speechEnvSchema } from "./env.js";
import { SpeechService } from "./service.js";
import { YandexSpeechProvider } from "./providers/yandex.js";
import { OpenRouterSpeechProvider } from "./providers/openrouter.js";
import { TinfoilSpeechProvider } from "./providers/tinfoil.js";
import type { SpeechProvider } from "./types.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    speech: SpeechService;
  }
}

export const speechModule: SkyeModule = {
  name: "speech",
  envSchema: speechEnvSchema,
  init(ctx) {
    const provider = buildProvider(ctx.config);
    return { service: new SpeechService(provider) };
  },
};

export function buildProvider(config: Readonly<Record<string, unknown>>): SpeechProvider {
  const provider = String(config.VOICE_PROVIDER ?? "yandex");

  if (provider === "openrouter") {
    const explicitKey = String(config.VOICE_OPENROUTER_API_KEY ?? "");
    const apiKey = explicitKey || String(config.OPENAI_KEY ?? "");
    const baseUrl =
      String(config.VOICE_OPENROUTER_BASE_URL ?? "") || "https://openrouter.ai/api/v1";

    return new OpenRouterSpeechProvider({
      apiKey,
      baseUrl,
      sttModel: String(config.VOICE_OPENROUTER_STT_MODEL ?? "nvidia/parakeet-tdt-0.6b-v3"),
      ttsModel: String(config.VOICE_OPENROUTER_TTS_MODEL ?? "google/gemini-3.1-flash-tts-preview"),
      ttsVoice: String(config.VOICE_OPENROUTER_TTS_VOICE ?? "alloy"),
      ttsResponseFormat: (config.VOICE_OPENROUTER_TTS_FORMAT as "mp3" | "pcm") ?? "mp3",
      sttInputFormat: (config.VOICE_OPENROUTER_STT_FORMAT as "mp3" | "wav" | "oggopus") ?? "mp3",
      sttLanguage: String(config.VOICE_OPENROUTER_STT_LANGUAGE ?? ""),
      referer: String(config.VOICE_OPENROUTER_REFERER ?? ""),
      title: String(config.VOICE_OPENROUTER_TITLE ?? ""),
      pcmSampleRate: Number(config.VOICE_OPENROUTER_PCM_SAMPLE_RATE ?? 48000),
      pcmChannels: Number(config.VOICE_OPENROUTER_PCM_CHANNELS ?? 1),
    });
  }


  if (provider === "tinfoil") {
    const explicitKey = String(config.VOICE_TINFOIL_API_KEY ?? "");
    const apiKey = explicitKey || String(config.OPENAI_KEY ?? "");
    const baseUrl =
      String(config.VOICE_TINFOIL_BASE_URL ?? "") || String(config.BASE_URL ?? "");

    return new TinfoilSpeechProvider({
      apiKey,
      baseUrl,
      sttModel: String(config.VOICE_TINFOIL_STT_MODEL ?? "whisper-large-v3-turbo"),
      ttsModel: String(config.VOICE_TINFOIL_TTS_MODEL ?? "qwen3-tts"),
      ttsVoice: String(config.VOICE_TINFOIL_TTS_VOICE ?? "serena"),
      sttInputFormat: (config.VOICE_TINFOIL_STT_FORMAT as "mp3" | "wav" | "oggopus") ?? "mp3",
      sttLanguage: String(config.VOICE_TINFOIL_STT_LANGUAGE ?? ""),
    });
  }

  return new YandexSpeechProvider({
    apiKey: String(config.YC_API_KEY ?? ""),
    folderId: String(config.YC_FOLDER_ID ?? ""),
    ttsVoice: String(config.YC_TTS_VOICE ?? "jane"),
    ttsEmotion: String(config.YC_TTS_EMOTION ?? "neutral"),
    ttsLang: String(config.YC_TTS_LANG ?? "ru-RU"),
    ttsSpeed: Number(config.YC_TTS_SPEED ?? 1.0),
  });
}