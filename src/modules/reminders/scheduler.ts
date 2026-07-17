import type { BackgroundJobsService } from "../jobs/service.js";
import type { RemindersService, Reminder } from "./service.js";
import { log } from "../../utils/log.js";

export const REMINDER_DELIVERY_JOB = "reminders.deliver";

export interface ReminderDeliveryPayload {
  reminder: Reminder;
}

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt: string | undefined;
  private lastError: string | undefined;

  constructor(
    private readonly deps: {
      service: RemindersService;
      jobs: BackgroundJobsService;
    },
    private readonly settings: {
      enabled: boolean;
      checkIntervalSec: number;
      graceSec: number;
    }
  ) {}

  start(): void {
    if (!this.settings.enabled || this.timer) return;
    this.timer = setInterval(() => this.tick(), this.settings.checkIntervalSec * 1000);
    this.timer.unref();
    this.tick();
    log.info(
      { intervalSec: this.settings.checkIntervalSec },
      "Reminder scheduler started with persistent delivery"
    );
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick(now: Date = new Date()): void {
    this.lastTickAt = now.toISOString();
    let due: Reminder[];
    try {
      due = this.deps.service.due(now);
      this.lastError = undefined;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      log.error({ error }, "Reminder scheduler failed to query due reminders");
      return;
    }

    for (const reminder of due) {
      const ageMs = now.getTime() - new Date(reminder.fireAt).getTime();
      if (ageMs > this.settings.graceSec * 1000) {
        this.deps.service.complete(reminder);
        log.info(
          { reminderId: reminder.id, ageSec: Math.round(ageMs / 1000) },
          "Skipped stale reminder delivery"
        );
        continue;
      }
      const result = this.deps.jobs.enqueue({
        id: reminderDeliveryJobId(reminder),
        kind: REMINDER_DELIVERY_JOB,
        payload: { reminder } satisfies ReminderDeliveryPayload,
        maxAttempts: 5,
      });
      if (result.inserted) {
        log.info(
          { reminderId: reminder.id, jobId: result.job.id, chatId: reminder.chatId },
          "Reminder delivery queued"
        );
      }
    }
  }

  diagnostics(): {
    enabled: boolean;
    running: boolean;
    inFlight: number;
    lastTickAt?: string;
    lastError?: string;
  } {
    return {
      enabled: this.settings.enabled,
      running: this.timer != null,
      inFlight: this.deps.jobs.diagnostics().running,
      ...(this.lastTickAt ? { lastTickAt: this.lastTickAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }
}

export function reminderDeliveryJobId(reminder: Pick<Reminder, "id" | "fireAt">): string {
  return `reminder:${reminder.id}:${reminder.fireAt}`;
}
