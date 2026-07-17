import type { SpeechProvider } from "../types.js";
import { transcodeAudio, type AudioFormat } from "../transcode.js";
import { log } from "../../../utils/log.js";

const STT_PATH = "/audio/transcriptions";
const TTS_PATH = "/audio/speech";

export interface TinfoilSettings {
  apiKey: string;
  baseUrl: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  ttsInstruct: string;
  sttInputFormat: AudioFormat;
  sttLanguage: string;
}

/**
 * Tinfoil speech adapter using the OpenAI-compatible /audio/transcriptions
 * and /audio/speech endpoints. STT sends multipart form data (standard
 * OpenAI whisper format). TTS returns WAV, transcoded to OGG Opus for
 * Telegram voice notes.
 *
 * Reuses the global OPENAI_KEY/BASE_URL by default (see speech module init).
 */
export class TinfoilSpeechProvider implements SpeechProvider {
  constructor(private settings: TinfoilSettings) {}

  isSttAvailable(): boolean {
    return this.settings.apiKey.length > 0 && this.settings.sttModel.length > 0;
  }

  isTtsAvailable(): boolean {
    return this.settings.apiKey.length > 0 && this.settings.ttsModel.length > 0;
  }

  async recognize(audioBuffer: Buffer, language: string = "ru-RU"): Promise<string | null> {
    if (!this.isSttAvailable()) {
      log.warn("Tinfoil speech not configured, cannot recognize speech");
      return null;
    }

    let normalized: Buffer;
    try {
      normalized = await transcodeAudio(audioBuffer, this.settings.sttInputFormat);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Tinfoil STT transcoding failed: ${msg}`);
      return null;
    }

    const lang = this.settings.sttLanguage || language.slice(0, 2);
    const ext = this.settings.sttInputFormat === "oggopus" ? "ogg" : this.settings.sttInputFormat;
    const mime =
      this.settings.sttInputFormat === "mp3"
        ? "audio/mpeg"
        : this.settings.sttInputFormat === "wav"
          ? "audio/wav"
          : "audio/ogg";

    const form = new FormData();
    form.append("model", this.settings.sttModel);
    form.append("file", new Blob([new Uint8Array(normalized)], { type: mime }), `audio.${ext}`);
    if (lang) form.append("language", lang);

    try {
      const res = await fetch(`${this.settings.baseUrl}${STT_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.settings.apiKey}` },
        body: form,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log.error(`Tinfoil STT failed (${res.status}): ${body}`);
        return null;
      }

      const data = (await res.json()) as { text?: string };
      return data.text || null;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Tinfoil STT error: ${msg}`);
      return null;
    }
  }

  async synthesize(text: string): Promise<Buffer | null> {
    if (!this.isTtsAvailable()) {
      log.warn("Tinfoil speech not configured, cannot synthesize speech");
      return null;
    }

    try {
      const body: Record<string, unknown> = {
        model: this.settings.ttsModel,
        input: text,
        voice: this.settings.ttsVoice,
      };
      if (this.settings.ttsInstruct) body.instruct = this.settings.ttsInstruct;

      const res = await fetch(`${this.settings.baseUrl}${TTS_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.settings.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        log.error(`Tinfoil TTS failed (${res.status}): ${body}`);
        return null;
      }

      const raw = Buffer.from(await res.arrayBuffer());
      return transcodeAudio(raw, "oggopus");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.error(`Tinfoil TTS error: ${msg}`);
      return null;
    }
  }
}
