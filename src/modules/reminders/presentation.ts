import { InlineKeyboard } from "grammy";
import type { Reminder } from "./service.js";

export const REMINDER_CALLBACK_PATTERN = /^reminder:(cancel|snooze):(rem_[0-9a-f-]+)$/;

export function formatReminderTime(fireAt: string | Date): string {
  const date = typeof fireAt === "string" ? new Date(fireAt) : fireAt;
  return `${date.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  })} UTC`;
}

export function reminderListMarkdown(reminders: Reminder[]): string {
  if (reminders.length === 0) return "_No active reminders in this chat._";
  const rows = reminders.map((reminder, index) => {
    const repeat = reminder.repeat !== "none" ? ` · ${reminder.repeat}` : "";
    const prompt = reminder.prompt.replace(/\s+/g, " ").slice(0, 60).replace(/\|/g, "\\|");
    return `| ${index + 1} | ${formatReminderTime(reminder.fireAt)}${repeat} | ${prompt} |`;
  });
  return [
    `## Reminders (${reminders.length})`,
    "",
    "| # | When | Prompt |",
    "|---|---|---|",
    ...rows,
    "",
    "Use the buttons below to postpone a reminder by one hour or cancel it.",
  ].join("\n");
}

export function reminderListKeyboard(reminders: Reminder[]): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  reminders.forEach((reminder, index) => {
    const number = index + 1;
    keyboard
      .text(`#${number} +1 hour`, `reminder:snooze:${reminder.id}`)
      .text(`#${number} Cancel`, `reminder:cancel:${reminder.id}`)
      .row();
  });
  return keyboard;
}
