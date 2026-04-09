import { NextResponse } from "next/server"
import { getMessages, getThread, saveMessage } from "@/lib/db"
import { streamChat } from "@/lib/ai"

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    if (!getThread(id))
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    return NextResponse.json(getMessages(id))
  } catch {
    return NextResponse.json(
      { error: "Failed to get messages" },
      { status: 500 }
    )
  }
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params

  if (!getThread(id))
    return NextResponse.json({ error: "Thread not found" }, { status: 404 })

  const { content, imageUrl } = await req.json()
  if (!content?.trim()) {
    return NextResponse.json(
      { error: "Message content required" },
      { status: 400 }
    )
  }

  // Persist user message before streaming
  saveMessage(id, "user", content.trim(), imageUrl ?? null)

  // History = all messages except the one we just saved
  const history = getMessages(id)
    .slice(0, -1)
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
      imageUrl: m.imageUrl,
    }))

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))

      try {
        for await (const event of streamChat(
          id,
          history,
          content.trim(),
          imageUrl ?? null
        )) {
          send(event)
          if (event.type === "done" || event.type === "error") break
        }
      } catch (err: unknown) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
