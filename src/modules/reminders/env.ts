import { z } from "zod";

export const remindersEnvSchema = z.object({
  REMINDERS_ENABLED: z.coerce.boolean().default(true),
  REMINDERS_CHECK_INTERVAL_SEC: z.coerce.number().int().min(1).max(3600).default(30),
  REMINDERS_GRACE_SEC: z.coerce.number().int().min(0).max(86400).default(300),
});

export type RemindersEnv = z.infer<typeof remindersEnvSchema>;
