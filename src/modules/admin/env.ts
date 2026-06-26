import { z } from "zod";

export const adminEnvSchema = z.object({
  ADMIN_IDS: z.string().default(""),
});

export type AdminEnv = z.infer<typeof adminEnvSchema>;

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