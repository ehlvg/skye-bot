import { z } from "zod";

export const channelEnvSchema = z.object({
  CHANNEL_ENABLED: z.coerce.boolean().default(false),
  // The Telegram chat id of the channel Skye manages. May be a public
  // @username (string) or a numeric supergroup/channel id (number/-100...).
  // Stored as a string so both forms survive the env flattening.
  CHANNEL_CHAT_ID: z.string().default(""),
  // When true, only users listed in ADMIN_IDS may trigger channel tools.
  CHANNEL_ADMIN_ONLY: z.coerce.boolean().default(true),
});

export type ChannelEnv = z.infer<typeof channelEnvSchema>;

/**
 * Resolve the configured channel chat id into a Telegram chat id usable with
 * the Bot API. Accepts either a numeric id (e.g. -1001234567890) or a public
 * @username (e.g. @skye_updates). Returns undefined when unconfigured.
 */
export function resolveChannelChatId(raw: string): number | string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("@")) return trimmed;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}
