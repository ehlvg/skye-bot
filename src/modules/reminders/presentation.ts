import type { Reminder } from "./service.js";

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
    "Commands:",
    "- `/postpone <number> <duration>` — move a reminder, for example `/postpone 1 35m` or `/postpone 2 2h`.",
    "- `/delete_reminder <number>` — delete a reminder, for example `/delete_reminder 1`.",
    "",
    "Supported duration units: `m` (minutes), `h` (hours), `d` (days), `w` (weeks).",
  ].join("\n");
}
