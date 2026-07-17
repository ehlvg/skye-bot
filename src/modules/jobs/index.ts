import type { SkyeModule } from "../../core/module.js";
import { jobsConfigSchema } from "./config.js";
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
  configSchema: jobsConfigSchema,
  migrations,
  init(ctx) {
    const c = ctx.config.background_jobs;
    const service = new SqliteBackgroundJobs(
      ctx.db,
      {
        enabled: c.enabled,
        pollIntervalMs: c.poll_interval_ms,
        leaseSec: c.lease_sec,
        retentionDays: c.retention_days,
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
