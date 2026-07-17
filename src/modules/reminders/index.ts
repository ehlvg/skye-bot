import type { SkyeModule } from "../../core/module.js";
import { remindersConfigSchema } from "./config.js";
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
  configSchema: remindersConfigSchema,
  migrations,
  init(ctx) {
    ctx.services.set("reminders", remindersService);

    const c = ctx.config.reminders;
    const scheduler = new ReminderScheduler(
      { service: remindersService, jobs: ctx.services.get("jobs") },
      {
        enabled: c.enabled,
        checkIntervalSec: c.check_interval_sec,
        graceSec: c.grace_sec,
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
