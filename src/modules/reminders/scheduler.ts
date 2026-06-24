import type { RemindersService, Reminder } from "./service.js";
import type { EventBus } from "../../core/events.js";
import { log } from "../../utils/log.js";

export interface ReminderFiredPayload {
  reminder: Reminder;
}

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private firing = new Set<string>();

  constructor(
    private readonly deps: {
      service: RemindersService;
      events: EventBus;
    },
    private readonly settings: {
      enabled: boolean;
      checkIntervalSec: number;
      graceSec: number;
    }
  ) {}

  start(): void {
    if (!this.settings.enabled) return;
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.settings.checkIntervalSec * 1000);
    this.timer.unref();
    log.info(
      { intervalSec: this.settings.checkIntervalSec },
      "Reminder scheduler started"
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<void> {
    const now = new Date();
    let due: Reminder[];
    try {
      due = this.deps.service.due(now);
    } catch (e) {
      log.error({ err: e }, "Reminder scheduler: failed to query due reminders");
      return;
    }
    if (due.length === 0) return;

    for (const reminder of due) {
      if (this.firing.has(reminder.id)) continue;
      this.firing.add(reminder.id);

      void (async () => {
        try {
          const fireAge = now.getTime() - new Date(reminder.fireAt).getTime();
          const isStale = fireAge > this.settings.graceSec * 1000;

          if (isStale) {
            log.info(
              { id: reminder.id, fireAgeSec: Math.round(fireAge / 1000) },
              "Reminder is stale (past grace), rescheduling/deactivating without firing"
            );
          } else {
            log.info({ id: reminder.id, chatId: reminder.chatId }, "Firing reminder");
            this.deps.events.emit("reminders.fired", { reminder });
          }

          if (reminder.repeat === "none") {
            this.deps.service.deactivate(reminder.id);
          } else {
            const next = this.deps.service.advanceRepeating(reminder);
            if (next) {
              this.deps.service.reschedule(reminder.id, next);
              log.info(
                { id: reminder.id, nextFireAt: next.toISOString() },
                "Repeating reminder rescheduled"
              );
            } else {
              this.deps.service.deactivate(reminder.id);
            }
          }
        } catch (e) {
          log.error({ err: e, id: reminder.id }, "Failed to process fired reminder");
        } finally {
          this.firing.delete(reminder.id);
        }
      })();
    }
  }
}