import { YC_API_KEY, YC_FOLDER_ID, ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID } from "./config.js";
import { log } from "./utils/log.js";

const STT_URL = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";
const EL_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export function isSpeechRecognitionAvailable(): boolean {
  return YC_API_KEY.length > 0;
}

export async function recognizeSpeech(
  audioBuffer: Buffer,
  language: string = "ru-RU"
): Promise<string | null> {
  if (!isSpeechRecognitionAvailable()) {
    log.warn("Yandex Cloud API key not configured, cannot recognize speech");
    return null;
  }

  const params = new URLSearchParams({
    lang: language,
    format: "oggopus",
  });

  if (YC_FOLDER_ID) {
    params.append("folderId", YC_FOLDER_ID);
  }

  try {
    const res = await fetch(`${STT_URL}?${params.toString()}`, {
      method: "POST",
      headers: {
        Authorization: `Api-Key ${YC_API_KEY}`,
      },
      body: new Uint8Array(audioBuffer),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.err(`Speech recognition failed (${res.status}): ${body}`);
      return null;
    }

    const data = (await res.json()) as { result?: string };
    return data.result || null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.err(`Speech recognition error: ${msg}`);
    return null;
  }
}

export function isTTSAvailable(): boolean {
  return ELEVENLABS_API_KEY.length > 0;
}

export async function synthesizeSpeech(text: string): Promise<Buffer | null> {
  if (!isTTSAvailable()) {
    log.warn("ElevenLabs API key not configured, cannot synthesize speech");
    return null;
  }

  try {
    const res = await fetch(`${EL_TTS_URL}/${ELEVENLABS_VOICE_ID}`, {
      method: "POST",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.err(`ElevenLabs TTS failed (${res.status}): ${body}`);
      return null;
    }

    return Buffer.from(await res.arrayBuffer());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.err(`ElevenLabs TTS error: ${msg}`);
    return null;
  }
}
