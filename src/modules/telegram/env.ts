import { z } from "zod";

export const telegramEnvSchema = z.object({
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  // Legacy manual allow-list. Seeds the admin allowlist table once on upgrade.
  ALLOWED_IDS: z.string().default(""),
  TELEGRAM_POLLING_LOCK: z.string().default("1"),
  TELEGRAM_MAX_ATTACHMENT_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(50 * 1024 * 1024)
    .default(25 * 1024 * 1024),
});

export type TelegramEnv = z.infer<typeof telegramEnvSchema>;

export function parseAllowedIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
  );
}
