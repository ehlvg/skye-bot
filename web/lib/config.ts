import { config } from "dotenv"
import { existsSync } from "fs"
import { resolve } from "path"

// Auto-load parent .env when running from web/ (dev mode)
if (!process.env.OPENAI_KEY) {
  const paths = [
    resolve(process.cwd(), "..", ".env"),
    resolve(process.cwd(), ".env"),
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      config({ path: p })
      break
    }
  }
}

export const OPENAI_KEY = process.env.OPENAI_KEY ?? ""
export const BASE_URL = process.env.BASE_URL ?? "https://openrouter.ai/api/v1"
export const MODEL = process.env.MODEL ?? "openai/gpt-oss-120b"
export const MAX_COMPLETION_TOKENS = parseInt(
  process.env.MAX_COMPLETION_TOKENS ?? "500",
  10
)
export const YC_API_KEY = process.env.YC_API_KEY ?? ""
export const YC_FOLDER_ID = process.env.YC_FOLDER_ID ?? ""
export const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? ""
export const ELEVENLABS_VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM"

/** Special chat_id used for web UI memories in the shared DB */
export const WEB_CHAT_ID = -999
