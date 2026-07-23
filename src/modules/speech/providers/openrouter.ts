import type { SpeechProvider, SpeechSynthesisOptions, TtsCapabilities } from "../types.js";
import { transcodeAudio, pcmToOggOpus, type AudioFormat } from "../transcode.js";
import { log } from "../../../utils/log.js";

const STT_PATH = "/audio/transcriptions";
const TTS_PATH = "/audio/speech";
const TTS_MAX_ATTEMPTS = 2;
const TTS_TIMEOUT_MS = 60_000;

export const GEMINI_TTS_VOICES = [
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
] as const;

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

  getTtsCapabilities(): TtsCapabilities {
    const isGemini = this.settings.ttsModel.toLowerCase().includes("gemini");
    return {
      defaultVoice: this.settings.ttsVoice,
      ...(isGemini ? { voices: GEMINI_TTS_VOICES } : {}),
      expressive: isGemini || this.settings.ttsModel.toLowerCase().includes("gpt-4o"),
    };
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

  async synthesize(
    text: string,
    options: SpeechSynthesisOptions = {},
    signal?: AbortSignal
  ): Promise<Buffer | null> {
    if (!this.isTtsAvailable()) {
      log.warn("OpenRouter speech not configured, cannot synthesize speech");
      return null;
    }

    const startedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(TTS_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const model = this.settings.ttsModel.toLowerCase();
      const input = model.includes("gemini") ? buildGeminiTtsInput(text, options) : text;
      const responseFormat = model.includes("gemini") ? "pcm" : this.settings.ttsResponseFormat;
      const body: Record<string, unknown> = {
        model: this.settings.ttsModel,
        input,
        voice: options.voice || this.settings.ttsVoice,
        response_format: responseFormat,
      };
      if (model.includes("openai/") && (options.style || options.scene)) {
        body.provider = {
          options: {
            openai: {
              instructions: [options.scene, options.style].filter(Boolean).join("\n"),
            },
          },
        };
      }

      let raw: Buffer | undefined;
      let contentType: string | null = null;
      for (let attempt = 1; attempt <= TTS_MAX_ATTEMPTS; attempt += 1) {
        const attemptStartedAt = Date.now();
        let res: Response;
        try {
          res = await fetch(`${this.settings.baseUrl}${TTS_PATH}`, {
            method: "POST",
            headers: this.headers({ "Content-Type": "application/json" }),
            body: JSON.stringify(body),
            signal: requestSignal,
          });
        } catch (error) {
          if (signal?.aborted) throw signal.reason;
          if (requestSignal.aborted) throw requestSignal.reason;
          if (attempt < TTS_MAX_ATTEMPTS) {
            log.warn(
              { err: error, attempt, elapsedMs: Date.now() - attemptStartedAt },
              "OpenRouter TTS request failed, retrying"
            );
            continue;
          }
          throw error;
        }
        const headersMs = Date.now() - attemptStartedAt;

        if (!res.ok) {
          const errorBody = await res.text().catch(() => "");
          if (res.status >= 500 && attempt < TTS_MAX_ATTEMPTS) {
            log.warn(
              { status: res.status, attempt, body: errorBody },
              "OpenRouter TTS returned a transient error, retrying"
            );
            continue;
          }
          log.error(`OpenRouter TTS failed (${res.status}): ${errorBody}`);
          return null;
        }

        const candidate = Buffer.from(await res.arrayBuffer());
        const bodyMs = Date.now() - attemptStartedAt - headersMs;
        const candidateContentType = res.headers.get("content-type");
        const generationId = res.headers.get("x-generation-id");
        const invalidReason = validateTtsBytes(
          candidate,
          candidateContentType,
          responseFormat,
          this.settings.pcmSampleRate,
          this.settings.pcmChannels
        );
        if (invalidReason && attempt < TTS_MAX_ATTEMPTS) {
          log.warn(
            {
              attempt,
              bytes: candidate.length,
              contentType: candidateContentType,
              generationId,
              invalidReason,
              headersMs,
              bodyMs,
            },
            "OpenRouter TTS returned invalid audio, retrying"
          );
          continue;
        }
        if (invalidReason) {
          log.error(
            {
              bytes: candidate.length,
              contentType: candidateContentType,
              generationId,
              invalidReason,
              headersMs,
              bodyMs,
            },
            "OpenRouter TTS returned invalid audio"
          );
          return null;
        }
        const pcmInfo = parsePcmContentType(candidateContentType);
        log.debug(
          {
            bytes: candidate.length,
            contentType: candidateContentType,
            generationId,
            rate: pcmInfo.rate,
            channels: pcmInfo.channels,
            estimatedDurationSeconds:
              responseFormat === "pcm"
                ? candidate.length /
                  ((pcmInfo.rate ?? this.settings.pcmSampleRate) *
                    (pcmInfo.channels ?? this.settings.pcmChannels) *
                    2)
                : undefined,
            attempt,
            headersMs,
            bodyMs,
            totalMs: Date.now() - startedAt,
          },
          "OpenRouter TTS audio received"
        );
        raw = candidate;
        contentType = candidateContentType;
        break;
      }
      if (!raw) return null;

      // PCM from OpenRouter is a raw s16le stream with no container/header, so
      // ffmpeg needs explicit format args. The actual sample rate is announced
      // in the Content-Type header (e.g. "audio/pcm;rate=24000;channels=1");
      // assuming the wrong rate produces sped-up / high-pitch output.
      if (responseFormat === "pcm") {
        const { rate, channels } = parsePcmContentType(contentType);
        return pcmToOggOpus(
          raw,
          rate ?? this.settings.pcmSampleRate,
          channels ?? this.settings.pcmChannels
        );
      }
      return transcodeAudio(raw, "oggopus");
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ err: e, elapsedMs: Date.now() - startedAt }, `OpenRouter TTS error: ${msg}`);
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

export function validateTtsBytes(
  audio: Buffer,
  contentType: string | null,
  responseFormat: "mp3" | "pcm",
  fallbackPcmRate = 24_000,
  fallbackPcmChannels = 1
): string | null {
  if (audio.length === 0) return "empty response body";
  if (contentType?.toLowerCase().includes("json")) return `unexpected ${contentType}`;
  if (responseFormat === "pcm") {
    if (contentType && !contentType.toLowerCase().startsWith("audio/pcm")) {
      return `unexpected ${contentType} for PCM response`;
    }
    const { rate, channels } = parsePcmContentType(contentType);
    const bytesPerSample = 2;
    const minimumBytes = Math.ceil(
      (rate ?? fallbackPcmRate) * (channels ?? fallbackPcmChannels) * bytesPerSample * 0.1
    );
    if (audio.length < minimumBytes) return "PCM response is shorter than 100 ms";
    const frameBytes = (channels ?? fallbackPcmChannels) * bytesPerSample;
    if (audio.length % frameBytes !== 0) {
      return "PCM response has an incomplete 16-bit sample";
    }
  } else {
    if (
      contentType &&
      !["audio/mpeg", "audio/mp3"].some((type) => contentType.toLowerCase().startsWith(type))
    ) {
      return `unexpected ${contentType} for MP3 response`;
    }
    if (audio.length < 128) return "MP3 response is too short";
  }
  return null;
}

export function buildGeminiTtsInput(transcript: string, options: SpeechSynthesisOptions): string {
  const sections: string[] = [];
  if (options.scene?.trim()) {
    sections.push(`## THE SCENE\n${options.scene.trim()}`);
  }
  if (options.style?.trim()) {
    sections.push(`## DIRECTOR'S NOTES\n${options.style.trim()}`);
  }
  if (sections.length === 0) return transcript;
  sections.push(`## TRANSCRIPT\n${transcript}`);
  return sections.join("\n\n");
}

/**
 * Parse "audio/pcm;rate=24000;channels=1" → { rate, channels }. Returns
 * undefined fields if the header is absent or malformed.
 */
export function parsePcmContentType(contentType: string | null): {
  rate?: number;
  channels?: number;
} {
  if (!contentType) return {};
  const rateMatch = contentType.match(/rate=(\d+)/i);
  const chMatch = contentType.match(/channels=(\d+)/i);
  return {
    rate: rateMatch ? Number(rateMatch[1]) : undefined,
    channels: chMatch ? Number(chMatch[1]) : undefined,
  };
}
