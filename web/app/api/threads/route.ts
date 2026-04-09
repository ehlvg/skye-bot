import { NextResponse } from "next/server"
import { createThread, listThreads } from "@/lib/db"

export async function GET() {
  try {
    return NextResponse.json(listThreads())
  } catch {
    return NextResponse.json(
      { error: "Failed to list threads" },
      { status: 500 }
    )
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const thread = createThread(
      (body as { name?: string }).name?.trim() || "New Chat"
    )
    return NextResponse.json(thread, { status: 201 })
  } catch {
    return NextResponse.json(
      { error: "Failed to create thread" },
      { status: 500 }
    )
  }
}
