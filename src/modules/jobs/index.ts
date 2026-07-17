import type { SkyeModule } from "../../core/module.js";
import { jobsEnvSchema, type JobsEnv } from "./env.js";
import { migrations } from "./migrations.js";
import { SqliteBackgroundJobs, type BackgroundJobsService } from "./service.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    jobs: BackgroundJobsService;
  }
}

let serviceRef: BackgroundJobsService | null = null;

export const jobsModule: SkyeModule = {
  name: "jobs",
  envSchema: jobsEnvSchema,
  migrations,
  init(ctx) {
    const cfg = ctx.config as JobsEnv;
    const service = new SqliteBackgroundJobs(
      ctx.db,
      {
        enabled: cfg.BACKGROUND_JOBS_ENABLED,
        pollIntervalMs: cfg.BACKGROUND_JOBS_POLL_INTERVAL_MS,
        leaseSec: cfg.BACKGROUND_JOBS_LEASE_SEC,
        retentionDays: cfg.BACKGROUND_JOBS_RETENTION_DAYS,
      },
      ctx.logger
    );
    serviceRef = service;
    return { service };
  },
  start() {
    serviceRef?.start();
  },
  async shutdown() {
    await serviceRef?.stop();
    serviceRef = null;
  },
};
