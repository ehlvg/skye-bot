import { z } from "zod";

export const speechEnvSchema = z.object({
  // Voice provider selection: "yandex" (default, backward compatible) or
  // "openrouter" (uses the same OPENAI_KEY/openai_key as chat by default).
  VOICE_PROVIDER: z.enum(["yandex", "openrouter", "tinfoil"]).default("yandex"),

  // Yandex Cloud SpeechKit — used for both STT and TTS.
  YC_API_KEY: z.string().default(""),
  YC_FOLDER_ID: z.string().default(""),
  // TTS voice and emotion. Defaults pick a neutral Russian female voice.
  // Voice catalogue: https://aistudio.yandex.ru/docs/ru/speechkit/tts/voices.html
  YC_TTS_VOICE: z.string().default("jane"),
  YC_TTS_EMOTION: z.string().default("neutral"),
  YC_TTS_LANG: z.string().default("ru-RU"),
  YC_TTS_SPEED: z.coerce.number().min(0.1).max(3.0).default(1.0),

  // OpenRouter speech — reuses OPENAI_KEY/BASE_URL by default. Override below
  // to use a dedicated key/base URL or to point at a non-default model.
  // STT docs: https://openrouter.ai/docs/guides/overview/multimodal/stt
  // TTS docs: https://openrouter.ai/docs/guides/overview/multimodal/tts
  VOICE_OPENROUTER_API_KEY: z.string().default(""),
  VOICE_OPENROUTER_BASE_URL: z
    .string()
    .url()
    .or(z.literal(""))
    .default("https://openrouter.ai/api/v1"),
  VOICE_OPENROUTER_STT_MODEL: z.string().default("nvidia/parakeet-tdt-0.6b-v3"),
  VOICE_OPENROUTER_TTS_MODEL: z.string().default("google/gemini-3.1-flash-tts-preview"),
  VOICE_OPENROUTER_TTS_VOICE: z.string().default("Aoede"),
  // Audio format returned by the TTS endpoint; mp3 is most reliable.
  VOICE_OPENROUTER_TTS_FORMAT: z.enum(["mp3", "pcm"]).default("mp3"),
  // PCM raw stream parameters (used only when TTS format = "pcm"). OpenRouter
  // returns 48 kHz mono s16le by default.
  VOICE_OPENROUTER_PCM_SAMPLE_RATE: z.coerce.number().int().positive().default(48000),
  VOICE_OPENROUTER_PCM_CHANNELS: z.coerce.number().int().positive().default(1),
  // Format to normalize input audio into before sending to STT. mp3 keeps
  // payload size small and is supported by all whisper-style models.
  VOICE_OPENROUTER_STT_FORMAT: z.enum(["mp3", "wav", "oggopus"]).default("mp3"),
  // ISO-639-1 language hint for STT; empty = auto-detect.
  VOICE_OPENROUTER_STT_LANGUAGE: z.string().default(""),
  // Optional OpenRouter ranking headers.
  VOICE_OPENROUTER_REFERER: z.string().default(""),
  VOICE_OPENROUTER_TITLE: z.string().default(""),

  // Tinfoil speech — uses the OpenAI-compatible /audio/transcriptions and
  // /audio/speech endpoints on inference.tinfoil.sh. By default reuses
  // OPENAI_KEY/BASE_URL (set VOICE_TINFOIL_API_KEY / VOICE_TINFOIL_BASE_URL
  // to override). Models: whisper-large-v3-turbo (STT), qwen3-tts (TTS).
  VOICE_TINFOIL_API_KEY: z.string().default(""),
  VOICE_TINFOIL_BASE_URL: z.string().url().or(z.literal("")).default(""),
  VOICE_TINFOIL_STT_MODEL: z.string().default("whisper-large-v3-turbo"),
  VOICE_TINFOIL_TTS_MODEL: z.string().default("qwen3-tts"),
  // qwen3-tts voices: aiden, dylan, eric, ono_anna, ryan, serena, sohee, uncle_fu, vivian
  VOICE_TINFOIL_TTS_VOICE: z.string().default("serena"),
  VOICE_TINFOIL_STT_FORMAT: z.enum(["mp3", "wav", "oggopus"]).default("mp3"),
  VOICE_TINFOIL_STT_LANGUAGE: z.string().default(""),

});

export type SpeechEnv = z.infer<typeof speechEnvSchema>;