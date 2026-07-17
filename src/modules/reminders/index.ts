import type { SkyeModule } from "../../core/module.js";
import { remindersEnvSchema, type RemindersEnv } from "./env.js";
import { migrations } from "./migrations.js";
import { remindersService, type RemindersService } from "./service.js";
import { ReminderScheduler } from "./scheduler.js";
import { reminderTools } from "./tools.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    reminders: RemindersService;
    reminderScheduler: ReminderScheduler;
  }
}

let schedulerRef: ReminderScheduler | null = null;

export const remindersModule: SkyeModule = {
  name: "reminders",
  envSchema: remindersEnvSchema,
  migrations,
  init(ctx) {
    ctx.services.set("reminders", remindersService);

    const cfg = ctx.config as RemindersEnv;
    const scheduler = new ReminderScheduler(
      { service: remindersService, jobs: ctx.services.get("jobs") },
      {
        enabled: cfg.REMINDERS_ENABLED,
        checkIntervalSec: cfg.REMINDERS_CHECK_INTERVAL_SEC,
        graceSec: cfg.REMINDERS_GRACE_SEC,
      }
    );
    schedulerRef = scheduler;
    ctx.services.set("reminderScheduler", scheduler);

    return {
      service: remindersService,
      tools: reminderTools(remindersService),
    };
  },
  start() {
    schedulerRef?.start();
  },
  shutdown() {
    schedulerRef?.stop();
    schedulerRef = null;
  },
};
