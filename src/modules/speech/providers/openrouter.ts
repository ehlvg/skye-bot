import type { SpeechProvider } from "../types.js";
import { transcodeAudio, pcmToOggOpus, type AudioFormat } from "../transcode.js";
import { log } from "../../../utils/log.js";

const STT_PATH = "/audio/transcriptions";
const TTS_PATH = "/audio/speech";

export interface OpenRouterSettings {
  apiKey: string;
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  /** Response format for TTS request (openrouter returns one of: mp3, pcm). */
  ttsResponseFormat: "mp3" | "pcm";
  /** Target format to normalize input audio to before STT (ffmpeg decodes anything). */
  sttInputFormat: AudioFormat;
  /** ISO-639-1 hint; empty = auto-detect. */
  sttLanguage: string;
  referer: string;
  title: string;
  /** PCM sample rate (OpenRouter returns 48000 Hz by default). */
  pcmSampleRate: number;
  /** PCM channel count (1 = mono). */
  pcmChannels: number;
}

/**
 * OpenRouter speech adapter using the dedicated /audio/transcriptions and
 * /audio/speech endpoints. STT accepts any audio (we normalize via ffmpeg) and
 * returns base64-wrapped JSON. TTS returns raw mp3/pcm which we transcode to
 * OGG Opus so the result can be sent as a Telegram voice note.
 *
 * Reuses the global OPENAI_KEY/BASE_URL by default (see speech module init).
 */
export class OpenRouterSpeechProvider implements SpeechProvider {
  constructor(private settings: OpenRouterSettings) {}

  isSttAvailable(): boolean {
    return this.settings.apiKey.length > 0 && this.settings.sttModel.length > 0;
  }

  isTtsAvailable(): boolean {
    return this.settings.apiKey.length > 0 && this.settings.ttsModel.length > 0;
  }

  async recognize(audioBuffer: Buffer, language: string = "ru-RU"): Promise<string | null> {
    if (!this.isSttAvailable()) {
      log.warn("OpenRouter speech not configured, cannot recognize speech");
      return null;
    }

    let normalized: Buffer;
    try {
      normalized = await transcodeAudio(audioBuffer, this.settings.sttInputFormat);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`OpenRouter STT transcoding failed: ${msg}`);
      return null;
    }

    const lang = this.settings.sttLanguage || language.slice(0, 2);

    try {
      const res = await fetch(`${this.settings.baseUrl}${STT_PATH}`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: this.settings.sttModel,
          input_audio: {
            data: normalized.toString("base64"),
            format: this.settings.sttInputFormat,
          },
          ...(lang ? { language: lang } : {}),
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log.error(`OpenRouter STT failed (${res.status}): ${body}`);
        return null;
      }

      const data = (await res.json()) as { text?: string };
      return data.text || null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`OpenRouter STT error: ${msg}`);
      return null;
    }
  }

  async synthesize(text: string): Promise<Buffer | null> {
    if (!this.isTtsAvailable()) {
      log.warn("OpenRouter speech not configured, cannot synthesize speech");
      return null;
    }

    try {
      const res = await fetch(`${this.settings.baseUrl}${TTS_PATH}`, {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          model: this.settings.ttsModel,
          input: text,
          voice: this.settings.ttsVoice,
          response_format: this.settings.ttsResponseFormat,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log.error(`OpenRouter TTS failed (${res.status}): ${body}`);
        return null;
      }

      const raw = Buffer.from(await res.arrayBuffer());

      // PCM from OpenRouter is a raw s16le stream with no container/header, so
      // ffmpeg needs explicit format args. The actual sample rate is announced
      // in the Content-Type header (e.g. "audio/pcm;rate=24000;channels=1");
      // assuming the wrong rate produces sped-up / high-pitch output.
      if (this.settings.ttsResponseFormat === "pcm") {
        const { rate, channels } = parsePcmContentType(res.headers.get("content-type"));
        return pcmToOggOpus(raw, rate ?? this.settings.pcmSampleRate, channels ?? this.settings.pcmChannels);
      }
      return transcodeAudio(raw, "oggopus");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`OpenRouter TTS error: ${msg}`);
      return null;
    }
  }

  private headers(extra: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${this.settings.apiKey}`,
      ...extra,
    };
    if (this.settings.referer) {
      h["HTTP-Referer"] = this.settings.referer;
    }
    if (this.settings.title) {
      h["X-OpenRouter-Title"] = this.settings.title;
    }
    return h;
  }
}

/**
 * Parse "audio/pcm;rate=24000;channels=1" → { rate, channels }. Returns
 * undefined fields if the header is absent or malformed.
 */
function parsePcmContentType(
  contentType: string | null
): { rate?: number; channels?: number } {
  if (!contentType) return {};
  const rateMatch = contentType.match(/rate=(\d+)/i);
  const chMatch = contentType.match(/channels=(\d+)/i);
  return {
    rate: rateMatch ? Number(rateMatch[1]) : undefined,
    channels: chMatch ? Number(chMatch[1]) : undefined,
  };
}