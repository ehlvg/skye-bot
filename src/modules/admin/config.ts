import { z } from "zod";

export const adminConfigSchema = z.object({
  admin_ids: z.string().default(""),
});

export type AdminConfig = z.infer<typeof adminConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    admin_ids: string;
  }
}

export function parseAdminIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
  );
}