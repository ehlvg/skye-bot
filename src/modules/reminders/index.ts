import type { SkyeModule } from "../../core/module.js";
import { remindersEnvSchema, type RemindersEnv } from "./env.js";
import { migrations } from "./migrations.js";
import { remindersService, type RemindersService } from "./service.js";
import { ReminderScheduler } from "./scheduler.js";
import { reminderTools } from "./tools.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    reminders: RemindersService;
  }
}

declare module "../../core/events.js" {
  interface SkyeEvents {
    "reminders.fired": { reminder: import("./service.js").Reminder };
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
      { service: remindersService, events: ctx.events },
      {
        enabled: cfg.REMINDERS_ENABLED,
        checkIntervalSec: cfg.REMINDERS_CHECK_INTERVAL_SEC,
        graceSec: cfg.REMINDERS_GRACE_SEC,
      }
    );
    schedulerRef = scheduler;

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