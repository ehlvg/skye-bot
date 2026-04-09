import { NextResponse } from "next/server"
import { getWebMemories } from "@/lib/db"

export async function GET() {
  try {
    return NextResponse.json(getWebMemories())
  } catch {
    return NextResponse.json(
      { error: "Failed to get memories" },
      { status: 500 }
    )
  }
}
