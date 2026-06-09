import { log } from "../../utils/log.js";

const STT_URL = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";
const TTS_URL = "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize";

export interface SpeechSettings {
  ycApiKey: string;
  ycFolderId: string;
  ttsVoice: string;
  ttsEmotion: string;
  ttsLang: string;
  ttsSpeed: number;
}

/**
 * Speech I/O backed by Yandex Cloud SpeechKit (v1 REST).
 * Both STT and TTS reuse YC_API_KEY (single Api-Key auth).
 *
 * TTS returns OGG Opus by default — directly usable as Telegram voice notes,
 * no transcoding required.
 */
export class SpeechService {
  constructor(private settings: SpeechSettings) {}

  /** True if a YC API key is configured. Same key drives STT and TTS. */
  isSttAvailable(): boolean {
    return this.settings.ycApiKey.length > 0;
  }

  isTtsAvailable(): boolean {
    return this.settings.ycApiKey.length > 0;
  }

  async recognize(audioBuffer: Buffer, language: string = "ru-RU"): Promise<string | null> {
    if (!this.isSttAvailable()) {
      log.warn("Yandex Cloud API key not configured, cannot recognize speech");
      return null;
    }

    const params = new URLSearchParams({ lang: language, format: "oggopus" });
    if (this.settings.ycFolderId) {
      params.append("folderId", this.settings.ycFolderId);
    }

    try {
      const res = await fetch(`${STT_URL}?${params.toString()}`, {
        method: "POST",
        headers: { Authorization: `Api-Key ${this.settings.ycApiKey}` },
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
   * Synthesize speech via Yandex SpeechKit TTS v1.
   * Returns OGG Opus bytes ready for Telegram replyWithVoice.
   * Max 5000 chars per call — longer texts are truncated by the caller.
   */
  async synthesize(text: string): Promise<Buffer | null> {
    if (!this.isTtsAvailable()) {
      log.warn("Yandex Cloud API key not configured, cannot synthesize speech");
      return null;
    }

    const body = new URLSearchParams({
      text,
      voice: this.settings.ttsVoice,
      lang: this.settings.ttsLang,
      emotion: this.settings.ttsEmotion,
      speed: String(this.settings.ttsSpeed),
      format: "oggopus",
    });
    if (this.settings.ycFolderId) {
      body.append("folderId", this.settings.ycFolderId);
    }

    try {
      const res = await fetch(TTS_URL, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${this.settings.ycApiKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });

      if (!res.ok) {
        const errorBody = await res.text().catch(() => "");
        log.error(`Yandex TTS failed (${res.status}): ${errorBody}`);
        return null;
      }

      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Yandex TTS error: ${msg}`);
      return null;
    }
  }
}
