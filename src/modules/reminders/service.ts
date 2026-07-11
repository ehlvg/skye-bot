import { getDb } from "../../core/db.js";

export type RepeatInterval = "none" | "hourly" | "daily" | "weekly" | "monthly";

export interface Reminder {
  id: string;
  chatId: number;
  threadId?: number;
  userId?: number;
  prompt: string;
  fireAt: string;
  repeat: RepeatInterval;
  createdAt: string;
  active: boolean;
}

type ReminderRow = {
  id: string;
  chat_id: number;
  thread_id: number | null;
  user_id: number | null;
  prompt: string;
  fire_at: string;
  repeat: string;
  created_at: string;
  active: number;
};

const VALID_REPEATS: RepeatInterval[] = ["none", "hourly", "daily", "weekly", "monthly"];

function normalizeRepeat(r: unknown): RepeatInterval {
  const s = String(r ?? "none").toLowerCase();
  return VALID_REPEATS.includes(s as RepeatInterval) ? (s as RepeatInterval) : "none";
}

function rowToReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    chatId: row.chat_id,
    ...(row.thread_id != null ? { threadId: row.thread_id } : {}),
    ...(row.user_id != null ? { userId: row.user_id } : {}),
    prompt: row.prompt,
    fireAt: row.fire_at,
    repeat: normalizeRepeat(row.repeat),
    createdAt: row.created_at,
    active: row.active === 1,
  };
}

function genId(): string {
  return `rem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function createReminder(
  chatId: number,
  prompt: string,
  fireAt: Date,
  opts: {
    threadId?: number;
    userId?: number;
    repeat?: RepeatInterval;
  } = {}
): Reminder {
  const id = genId();
  const repeat = opts.repeat ?? "none";
  const createdAt = new Date().toISOString();

  getDb()
    .prepare(
      `INSERT INTO reminders (id, chat_id, thread_id, user_id, prompt, fire_at, repeat, created_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
    )
    .run(
      id,
      chatId,
      opts.threadId ?? null,
      opts.userId ?? null,
      prompt,
      fireAt.toISOString(),
      repeat,
      createdAt
    );

  return {
    id,
    chatId,
    ...(opts.threadId != null ? { threadId: opts.threadId } : {}),
    ...(opts.userId != null ? { userId: opts.userId } : {}),
    prompt,
    fireAt: fireAt.toISOString(),
    repeat,
    createdAt,
    active: true,
  };
}

export function updateReminder(
  id: string,
  chatId: number,
  patch: {
    prompt?: string;
    fireAt?: Date;
    repeat?: RepeatInterval;
  }
): Reminder | null {
  const existing = getReminder(id, chatId);
  if (!existing) return null;

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (patch.prompt !== undefined) {
    sets.push("prompt = ?");
    vals.push(patch.prompt);
  }
  if (patch.fireAt !== undefined) {
    sets.push("fire_at = ?");
    vals.push(patch.fireAt.toISOString());
  }
  if (patch.repeat !== undefined) {
    sets.push("repeat = ?");
    vals.push(patch.repeat);
  }
  if (sets.length === 0) return existing;

  vals.push(id, chatId);
  getDb()
    .prepare(`UPDATE reminders SET ${sets.join(", ")} WHERE id = ? AND chat_id = ?`)
    .run(...vals);

  return getReminder(id, chatId);
}

export function deleteReminder(id: string, chatId: number): boolean {
  const result = getDb()
    .prepare("UPDATE reminders SET active = 0 WHERE id = ? AND chat_id = ? AND active = 1")
    .run(id, chatId);
  return result.changes > 0;
}

export function getReminder(id: string, chatId: number): Reminder | null {
  const row = getDb()
    .prepare<[string, number], ReminderRow>(
      "SELECT * FROM reminders WHERE id = ? AND chat_id = ? AND active = 1"
    )
    .get(id, chatId);
  return row ? rowToReminder(row) : null;
}

export function listReminders(chatId: number): Reminder[] {
  const rows = getDb()
    .prepare<[number], ReminderRow>(
      "SELECT * FROM reminders WHERE chat_id = ? AND active = 1 ORDER BY fire_at ASC"
    )
    .all(chatId);
  return rows.map(rowToReminder);
}

export function listRemindersByUser(userId: number): Reminder[] {
  const rows = getDb()
    .prepare<[number], ReminderRow>(
      "SELECT * FROM reminders WHERE user_id = ? AND active = 1 ORDER BY fire_at ASC"
    )
    .all(userId);
  return rows.map(rowToReminder);
}

export function dueReminders(now: Date = new Date()): Reminder[] {
  const rows = getDb()
    .prepare<[string], ReminderRow>(
      "SELECT * FROM reminders WHERE active = 1 AND fire_at <= ? ORDER BY fire_at ASC"
    )
    .all(now.toISOString());
  return rows.map(rowToReminder);
}

export function advanceRepeatingReminder(reminder: Reminder): Date | null {
  if (reminder.repeat === "none") return null;
  const base = new Date(reminder.fireAt);
  let next: Date;
  switch (reminder.repeat) {
    case "hourly":
      next = new Date(base.getTime() + 60 * 60 * 1000);
      break;
    case "daily":
      next = new Date(base.getTime() + 24 * 60 * 60 * 1000);
      break;
    case "weekly":
      next = new Date(base.getTime() + 7 * 24 * 60 * 60 * 1000);
      break;
    case "monthly": {
      next = new Date(base);
      next.setMonth(next.getMonth() + 1);
      break;
    }
    default:
      return null;
  }
  while (next <= new Date()) {
    switch (reminder.repeat) {
      case "hourly":
        next = new Date(next.getTime() + 60 * 60 * 1000);
        break;
      case "daily":
        next = new Date(next.getTime() + 24 * 60 * 60 * 1000);
        break;
      case "weekly":
        next = new Date(next.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case "monthly":
        next.setMonth(next.getMonth() + 1);
        break;
    }
  }
  return next;
}

export function deactivateReminder(id: string): void {
  getDb().prepare("UPDATE reminders SET active = 0 WHERE id = ?").run(id);
}

export function countActiveRemindersByUser(userId: number): number {
  const row = getDb()
    .prepare<[number], { count: number }>(
      "SELECT COUNT(*) AS count FROM reminders WHERE user_id = ? AND active = 1"
    )
    .get(userId);
  return row?.count ?? 0;
}

export function rescheduleReminder(id: string, newFireAt: Date): void {
  getDb().prepare("UPDATE reminders SET fire_at = ? WHERE id = ?").run(newFireAt.toISOString(), id);
}

export interface RemindersService {
  create(
    chatId: number,
    prompt: string,
    fireAt: Date,
    opts?: { threadId?: number; userId?: number; repeat?: RepeatInterval }
  ): Reminder;
  update(
    id: string,
    chatId: number,
    patch: { prompt?: string; fireAt?: Date; repeat?: RepeatInterval }
  ): Reminder | null;
  delete(id: string, chatId: number): boolean;
  get(id: string, chatId: number): Reminder | null;
  list(chatId: number): Reminder[];
  due(now?: Date): Reminder[];
  advanceRepeating(reminder: Reminder): Date | null;
  deactivate(id: string): void;
  reschedule(id: string, newFireAt: Date): void;
  countActiveByUser(userId: number): number;
}

export const remindersService: RemindersService = {
  create: createReminder,
  update: updateReminder,
  delete: deleteReminder,
  get: getReminder,
  list: listReminders,
  due: dueReminders,
  advanceRepeating: advanceRepeatingReminder,
  deactivate: deactivateReminder,
  reschedule: rescheduleReminder,
  countActiveByUser: countActiveRemindersByUser,
};
