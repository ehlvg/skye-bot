import { z } from "zod";

export const jobsEnvSchema = z.object({
  BACKGROUND_JOBS_ENABLED: z.coerce.boolean().default(true),
  BACKGROUND_JOBS_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(1000),
  BACKGROUND_JOBS_LEASE_SEC: z.coerce.number().int().min(30).max(3600).default(300),
  BACKGROUND_JOBS_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(7),
});

export type JobsEnv = z.infer<typeof jobsEnvSchema>;
