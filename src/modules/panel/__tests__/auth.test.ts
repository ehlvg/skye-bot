import { createHmac } from "crypto";
import { describe, expect, test } from "vitest";
import { validateInitData } from "../auth.js";

const BOT_TOKEN = "123456:test-token";
const NOW = 1_800_000_000;

function signed(authDate: number): string {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "query",
    user: JSON.stringify({ id: 42, first_name: "Skye" }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  params.set("hash", createHmac("sha256", secret).update(check).digest("hex"));
  return params.toString();
}

describe("Telegram Mini App authentication", () => {
  test("accepts a fresh signed payload", () => {
    expect(validateInitData(signed(NOW - 10), BOT_TOKEN, 3_600, NOW)?.user.id).toBe(42);
  });

  test("rejects stale, future, and tampered payloads", () => {
    expect(validateInitData(signed(NOW - 3_601), BOT_TOKEN, 3_600, NOW)).toBeNull();
    expect(validateInitData(signed(NOW + 31), BOT_TOKEN, 3_600, NOW)).toBeNull();
    expect(
      validateInitData(signed(NOW).replace("Skye", "Mallory"), BOT_TOKEN, 3_600, NOW)
    ).toBeNull();
  });
});
