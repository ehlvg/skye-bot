import { NextResponse } from "next/server"
import { deleteWebMemory } from "@/lib/db"

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    const ok = deleteWebMemory(id)
    if (!ok)
      return NextResponse.json({ error: "Memory not found" }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: "Failed to delete memory" },
      { status: 500 }
    )
  }
}
