import type { Reminder, RemindersService } from "./service.js";

export type ReminderControlAction = "cancel" | "snooze";

export type ReminderControlResult =
  | { status: "cancelled"; reminder: Reminder }
  | { status: "snoozed"; reminder: Reminder }
  | { status: "forbidden"; reminder: Reminder }
  | { status: "not_found" };

export const REMINDER_SNOOZE_MS = 60 * 60 * 1_000;

/** Apply an inline reminder action with chat and owner isolation. */
export function applyReminderControl(
  service: RemindersService,
  input: {
    action: ReminderControlAction;
    id: string;
    chatId: number;
    userId?: number;
    now?: Date;
  }
): ReminderControlResult {
  const reminder = service.get(input.id, input.chatId);
  if (!reminder) return { status: "not_found" };
  if (reminder.userId != null && reminder.userId !== input.userId) {
    return { status: "forbidden", reminder };
  }

  if (input.action === "cancel") {
    service.delete(reminder.id, input.chatId);
    return { status: "cancelled", reminder };
  }

  const fireAt = new Date((input.now ?? new Date()).getTime() + REMINDER_SNOOZE_MS);
  const updated = service.update(reminder.id, input.chatId, { fireAt });
  return { status: "snoozed", reminder: updated ?? reminder };
}
