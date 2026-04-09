import { NextResponse } from "next/server"
import { deleteThread, renameThread } from "@/lib/db"

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Params) {
  try {
    const { id } = await params
    const { name } = await req.json()
    if (!name?.trim())
      return NextResponse.json({ error: "Name required" }, { status: 400 })
    const ok = renameThread(id, name.trim())
    if (!ok)
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to rename thread" },
      { status: 500 }
    )
  }
}

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    const ok = deleteThread(id)
    if (!ok)
      return NextResponse.json({ error: "Thread not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to delete thread" },
      { status: 500 }
    )
  }
}
