import type { Reminder, RemindersService } from "./service.js";

export type ReminderControlAction = "delete" | "postpone";

export type ReminderControlResult =
  | { status: "deleted"; reminder: Reminder }
  | { status: "postponed"; reminder: Reminder }
  | { status: "forbidden"; reminder: Reminder }
  | { status: "not_found" };

const MIN_POSTPONE_MS = 60 * 1_000;
export const MAX_POSTPONE_MS = 365 * 24 * 60 * 60 * 1_000;

const DURATION_UNITS: Record<string, number> = {
  m: 60 * 1_000,
  h: 60 * 60 * 1_000,
  d: 24 * 60 * 60 * 1_000,
  w: 7 * 24 * 60 * 60 * 1_000,
};

/** Parse a compact duration such as 35m, 2h, 3d, or 1w. */
export function parseReminderDuration(raw: string): number | null {
  const match = raw
    .trim()
    .replace(/\s+/g, "")
    .match(/^(\d+)([mhdw])$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const multiplier = DURATION_UNITS[match[2].toLowerCase()];
  const durationMs = amount * multiplier;
  if (!Number.isSafeInteger(durationMs)) return null;
  if (durationMs < MIN_POSTPONE_MS || durationMs > MAX_POSTPONE_MS) return null;
  return durationMs;
}

/** Apply a numbered reminder command with chat and owner isolation. */
export function applyReminderControl(
  service: RemindersService,
  input: {
    action: ReminderControlAction;
    number: number;
    chatId: number;
    userId?: number;
    durationMs?: number;
    now?: Date;
  }
): ReminderControlResult {
  const reminder = service.list(input.chatId)[input.number - 1];
  if (!reminder) return { status: "not_found" };
  if (reminder.userId != null && reminder.userId !== input.userId) {
    return { status: "forbidden", reminder };
  }

  if (input.action === "delete") {
    service.delete(reminder.id, input.chatId);
    return { status: "deleted", reminder };
  }

  const durationMs = input.durationMs ?? 0;
  const now = (input.now ?? new Date()).getTime();
  const scheduled = new Date(reminder.fireAt).getTime();
  const fireAt = new Date(Math.max(now, scheduled) + durationMs);
  const updated = service.update(reminder.id, input.chatId, { fireAt });
  return { status: "postponed", reminder: updated ?? reminder };
}
