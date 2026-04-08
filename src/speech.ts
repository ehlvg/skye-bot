import { YC_API_KEY, YC_FOLDER_ID } from "./config.js";
import { log } from "./utils/log.js";

const STT_URL = "https://stt.api.cloud.yandex.net/speech/v1/stt:recognize";

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
