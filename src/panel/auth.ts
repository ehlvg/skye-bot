import { createHmac } from "crypto";
import { BOT_TOKEN } from "../config.js";

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface ValidatedInitData {
  user: TelegramUser;
  queryId?: string;
  authDate: number;
}

export function validateInitData(initData: string): ValidatedInitData | null {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  const dataCheckString = [...params.entries()]
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const computedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (computedHash !== hash) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;

  try {
    const user = JSON.parse(userRaw) as TelegramUser;
    if (!user.id) return null;
    return {
      user,
      queryId: params.get("query_id") ?? undefined,
      authDate,
    };
  } catch {
    return null;
  }
}
