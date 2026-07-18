import { z } from "zod";
import { section } from "../../core/config.js";

export const accessModeSchema = z.enum(["private", "allowlist", "subscription", "open"]);
export type AccessMode = z.infer<typeof accessModeSchema>;

export const adminConfigSchema = z.object({
  admin_ids: z.string().default(""),
  access: section({
    mode: accessModeSchema.default("subscription"),
  }),
});

export type AdminConfig = z.infer<typeof adminConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    admin_ids: string;
    access: { mode: AccessMode };
  }
}

export function parseAdminIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isSafeInteger(n) && n > 0)
  );
}

export function parseAllowedIds(raw: string): Set<number> {
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isSafeInteger(n) && n !== 0)
  );
}
