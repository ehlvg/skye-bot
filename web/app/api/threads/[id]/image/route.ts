import { NextResponse } from "next/server"
import { getThread, saveMessage } from "@/lib/db"
import { generateImage } from "@/lib/ai"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  try {
    const { id } = await params
    if (!getThread(id))
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })

    const { prompt, imageUrl } = await req.json()
    if (!prompt?.trim())
      return NextResponse.json({ error: "Prompt required" }, { status: 400 })

    saveMessage(id, "user", prompt.trim(), imageUrl ?? null)

    const resultUrl = await generateImage(prompt.trim(), imageUrl ?? null)

    const msg = saveMessage(id, "assistant", "Generated image", resultUrl)
    return NextResponse.json({ message: msg, imageUrl: resultUrl })
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Image generation failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
