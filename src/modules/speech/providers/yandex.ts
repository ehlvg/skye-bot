import type { SpeechProvider, SpeechSynthesisOptions, TtsCapabilities } from "../types.js";
import { log } from "../../../utils/log.js";

const STT_URL = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";
const TTS_URL = "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize";
const TTS_TIMEOUT_MS = 60_000;

export interface YandexSettings {
  apiKey: string;
  folderId: string;
  ttsVoice: string;
  ttsEmotion: string;
  ttsLang: string;
  ttsSpeed: number;
}

/**
 * SpeechKit v1 REST adapter. TTS returns OGG Opus — directly usable as a
 * Telegram voice note, no transcoding required.
 */
export class YandexSpeechProvider implements SpeechProvider {
  constructor(private settings: YandexSettings) {}

  isSttAvailable(): boolean {
    return this.settings.apiKey.length > 0;
  }

  isTtsAvailable(): boolean {
    return this.settings.apiKey.length > 0;
  }

  getTtsCapabilities(): TtsCapabilities {
    return {
      defaultVoice: this.settings.ttsVoice,
      expressive: false,
    };
  }

  async recognize(audioBuffer: Buffer, language: string = "ru-RU"): Promise<string | null> {
    if (!this.isSttAvailable()) {
      log.warn("Yandex Cloud API key not configured, cannot recognize speech");
      return null;
    }

    const params = new URLSearchParams({ lang: language, format: "oggopus" });
    if (this.settings.folderId) {
      params.append("folderId", this.settings.folderId);
    }

    try {
      const res = await fetch(`${STT_URL}?${params.toString()}`, {
        method: "POST",
        headers: { Authorization: `Api-Key ${this.settings.apiKey}` },
        body: new Uint8Array(audioBuffer),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log.error(`Speech recognition failed (${res.status}): ${body}`);
        return null;
      }

      const data = (await res.json()) as { result?: string };
      return data.result || null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Speech recognition error: ${msg}`);
      return null;
    }
  }

  /**
   * Max 5000 chars per call — longer texts are truncated by the caller.
   * Returns OGG Opus bytes ready for Telegram replyWithVoice.
   */
  async synthesize(
    text: string,
    options: SpeechSynthesisOptions = {},
    signal?: AbortSignal
  ): Promise<Buffer | null> {
    if (!this.isTtsAvailable()) {
      log.warn("Yandex Cloud API key not configured, cannot synthesize speech");
      return null;
    }

    const body = new URLSearchParams({
      text,
      voice: options.voice || this.settings.ttsVoice,
      lang: this.settings.ttsLang,
      emotion: this.settings.ttsEmotion,
      speed: String(this.settings.ttsSpeed),
      format: "oggopus",
    });
    if (this.settings.folderId) {
      body.append("folderId", this.settings.folderId);
    }

    const startedAt = Date.now();
    const timeoutSignal = AbortSignal.timeout(TTS_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const res = await fetch(TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${this.settings.apiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: requestSignal,
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        log.error(`Yandex TTS failed (${res.status}): ${errorBody}`);
        return null;
      }

      const audio = Buffer.from(await res.arrayBuffer());
      log.debug(
        { provider: "yandex", bytes: audio.length, totalMs: Date.now() - startedAt },
        "TTS audio prepared"
      );
      return audio;
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      const msg = e instanceof Error ? e.message : String(e);
      log.error({ err: e, elapsedMs: Date.now() - startedAt }, `Yandex TTS error: ${msg}`);
      return null;
    }
  }
}
