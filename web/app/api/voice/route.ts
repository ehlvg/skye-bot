import { NextResponse } from "next/server"
import { YC_API_KEY, YC_FOLDER_ID } from "@/lib/config"

export async function GET() {
  return NextResponse.json({ available: Boolean(YC_API_KEY && YC_FOLDER_ID) })
}

export async function POST(req: Request) {
  if (!YC_API_KEY || !YC_FOLDER_ID) {
    return NextResponse.json(
      { error: "Voice recognition is not configured" },
      { status: 503 }
    )
  }

  try {
    const formData = await req.formData()
    const audio = formData.get("audio") as Blob | null
    if (!audio)
      return NextResponse.json(
        { error: "No audio file provided" },
        { status: 400 }
      )

    const audioBuffer = await audio.arrayBuffer()
    const contentType =
      audio.type && audio.type !== "application/octet-stream"
        ? audio.type
        : "application/octet-stream"

    // Yandex SpeechKit STT "recognize" supports oggopus (and a few others).
    // Web browsers often record as audio/webm;codecs=opus which SpeechKit does not accept.
    if (!contentType.includes("ogg")) {
      return NextResponse.json(
        {
          error:
            "Unsupported audio format from browser. SpeechKit requires OGG/Opus (oggopus).",
          receivedContentType: contentType,
        },
        { status: 415 }
      )
    }

    const response = await fetch(
      `https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?folderId=${YC_FOLDER_ID}&lang=ru-RU&format=oggopus`,
      {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${YC_API_KEY}`,
          "Content-Type": "audio/ogg",
        },
        body: audioBuffer,
      }
    )

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      return NextResponse.json(
        { error: `STT service error: ${body}` },
        { status: 502 }
      )
    }

    const data = (await response.json()) as { result?: string }
    return NextResponse.json({ text: data.result ?? "" })
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Voice recognition failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
