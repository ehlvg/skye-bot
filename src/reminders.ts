import { readFileSync, existsSync } from "fs";
import { writeFile, mkdir, access } from "fs/promises";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { log } from "./utils/log.js";

export interface Reminder {
  id: string;
  chatId: number;
  threadId?: number;
  text: string;
  triggerAt: string; // ISO 8601
}

export type ReminderSendFn = (
  chatId: number,
  threadId: number | undefined,
  text: string
) => Promise<void>;

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "data");
const REMINDERS_FILE = join(DATA_DIR, "reminders.json");

const store: Reminder[] = [];
let _send: ReminderSendFn | undefined;

// Load persisted reminders on import
if (existsSync(REMINDERS_FILE)) {
  try {
    const raw = JSON.parse(readFileSync(REMINDERS_FILE, "utf-8"));
    if (Array.isArray(raw)) store.push(...raw);
  } catch {
    // Corrupted file — start fresh
  }
}

async function persist(): Promise<void> {
  try {
    await access(DATA_DIR);
  } catch {
    await mkdir(DATA_DIR, { recursive: true });
  }
  await writeFile(REMINDERS_FILE, JSON.stringify(store, null, 2));
}

function generateId(): string {
  return "rem_" + Math.random().toString(36).slice(2, 10);
}

function removeReminder(id: string): void {
  const idx = store.findIndex((r) => r.id === id);
  if (idx !== -1) {
    store.splice(idx, 1);
    void persist();
  }
}

function scheduleOne(reminder: Reminder, send: ReminderSendFn): void {
  const delay = new Date(reminder.triggerAt).getTime() - Date.now();

  const fire = () => {
    void send(reminder.chatId, reminder.threadId, `⏰ ${reminder.text}`)
      .catch((e) => log.err(`Reminder ${reminder.id} failed: ${e?.message || e}`))
      .finally(() => removeReminder(reminder.id));
  };

  if (delay <= 0) {
    fire();
  } else {
    setTimeout(fire, delay);
  }
}

/** Call once on startup to schedule all persisted reminders. */
export function initReminders(send: ReminderSendFn): void {
  _send = send;
  for (const reminder of [...store]) {
    scheduleOne(reminder, send);
    log.info(`Scheduled reminder ${reminder.id} for ${reminder.triggerAt}`);
  }
}

export async function addReminder(
  chatId: number,
  threadId: number | undefined,
  text: string,
  triggerAt: string
): Promise<Reminder> {
  const reminder: Reminder = { id: generateId(), chatId, threadId, text, triggerAt };
  store.push(reminder);
  await persist();
  if (_send) scheduleOne(reminder, _send);
  log.info(`New reminder ${reminder.id} for ${triggerAt}`);
  return reminder;
}
