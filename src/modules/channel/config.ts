import { z } from "zod";
import { section } from "../../core/config.js";

export const channelConfigSchema = z.object({
  channel: section({
    enabled: z.boolean().default(false),
    chat_id: z.string().default(""),
    admin_only: z.boolean().default(true),
  }),
});

export type ChannelConfig = z.infer<typeof channelConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    channel: {
      enabled: boolean;
      chat_id: string;
      admin_only: boolean;
    };
  }
}

export function resolveChannelChatId(raw: string): number | string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("@")) return trimmed;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}