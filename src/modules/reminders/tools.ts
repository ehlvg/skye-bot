import type { ToolDefinition } from "../../core/module.js";
import type { RemindersService, RepeatInterval } from "./service.js";

const REPEAT_VALUES = ["none", "hourly", "daily", "weekly", "monthly"] as const;
const MAX_ACTIVE_REMINDERS_PER_USER = 25;

function parseDateTime(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (isNaN(d.getTime())) return null;
  return d;
}

function formatReminderList(reminders: ReturnType<RemindersService["list"]>): string {
  if (reminders.length === 0) return "No reminders found.";
  const lines = reminders.map((r, i) => {
    const local = new Date(r.fireAt).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });
    return `${i + 1}. ID \`${r.id}\` — ${local} (repeat: ${r.repeat})\n   ${r.prompt.slice(0, 120)}`;
  });
  return `Found ${reminders.length} reminder(s):\n${lines.join("\n")}`;
}

export function reminderTools(service: RemindersService): ToolDefinition[] {
  return [
    {
      name: "set_reminder",
      description:
        "Set a reminder for this chat. The reminder will fire at the specified time and Skye will act on it — e.g. remind the user about something, proactively start a task, or follow up. When it fires, Skye sees the full chat context and decides what to do based on the prompt. Use this when the user asks to be reminded, or when you want to schedule a future action for yourself. Always compute the exact date and time from the current date provided in the system prompt.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description:
              "What Skye should do or say when the reminder fires. Be specific — e.g. 'Remind the user to call the dentist' or 'Follow up on the deployment status and check if the build succeeded'.",
          },
          fire_at: {
            type: "string",
            description:
              "When the reminder should fire, as an ISO 8601 datetime string (e.g. '2024-12-25T10:00:00'). Use the current date from the system prompt to compute this. Must be in the future.",
          },
          repeat: {
            type: "string",
            enum: REPEAT_VALUES as unknown as string[],
            description:
              "Repeat interval. 'none' = one-time. 'hourly', 'daily', 'weekly', 'monthly' = repeating. Default: none.",
          },
        },
        required: ["prompt", "fire_at"],
      },
      execute: async (args, tenant) => {
        const prompt = String(args.prompt ?? "").trim();
        const fireAtRaw = String(args.fire_at ?? "").trim();
        const repeatRaw = String(args.repeat ?? "none").toLowerCase();
        const repeat = REPEAT_VALUES.includes(repeatRaw as RepeatInterval)
          ? (repeatRaw as RepeatInterval)
          : "none";

        if (!prompt) return "Error: prompt is required.";
        const fireAt = parseDateTime(fireAtRaw);
        if (!fireAt)
          return `Error: could not parse fire_at "${fireAtRaw}". Use ISO 8601 format like "2024-12-25T10:00:00".`;
        if (fireAt <= new Date()) {
          return `Error: fire_at must be in the future. Current time is ${new Date().toISOString()}.`;
        }
        if (
          tenant.userId != null &&
          service.countActiveByUser(tenant.userId) >= MAX_ACTIVE_REMINDERS_PER_USER
        ) {
          return `Error: you can have at most ${MAX_ACTIVE_REMINDERS_PER_USER} active reminders.`;
        }

        const reminder = service.create(tenant.chatId, prompt, fireAt, {
          ...(tenant.threadId != null ? { threadId: tenant.threadId } : {}),
          ...(tenant.userId != null ? { userId: tenant.userId } : {}),
          repeat,
        });

        const local = fireAt.toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        });
        return `Reminder set. ID: ${reminder.id}. Will fire ${local}${repeat !== "none" ? `, repeating ${repeat}` : ""}.`;
      },
    },
    {
      name: "list_reminders",
      description:
        "List all active reminders for this chat. Returns their IDs, fire times, repeat settings, and prompts.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async (_args, tenant) => {
        const reminders = service.list(tenant.chatId);
        return formatReminderList(reminders);
      },
    },
    {
      name: "update_reminder",
      description:
        "Update an existing reminder's prompt, fire time, or repeat setting. Use list_reminders first to get the ID if needed.",
      parameters: {
        type: "object",
        properties: {
          reminder_id: {
            type: "string",
            description: "The ID of the reminder to update (e.g. rem_abc123).",
          },
          prompt: {
            type: "string",
            description: "New prompt text for the reminder. Optional.",
          },
          fire_at: {
            type: "string",
            description: "New fire time as ISO 8601 datetime string. Optional.",
          },
          repeat: {
            type: "string",
            enum: REPEAT_VALUES as unknown as string[],
            description: "New repeat interval. Optional.",
          },
        },
        required: ["reminder_id"],
      },
      execute: async (args, tenant) => {
        const id = String(args.reminder_id ?? "").trim();
        if (!id) return "Error: reminder_id is required.";

        const patch: {
          prompt?: string;
          fireAt?: Date;
          repeat?: RepeatInterval;
        } = {};

        if (typeof args.prompt === "string" && args.prompt.trim()) {
          patch.prompt = args.prompt.trim();
        }
        if (typeof args.fire_at === "string" && args.fire_at.trim()) {
          const d = parseDateTime(args.fire_at);
          if (!d) return `Error: could not parse fire_at "${args.fire_at}".`;
          if (d <= new Date()) {
            return `Error: fire_at must be in the future. Current time is ${new Date().toISOString()}.`;
          }
          patch.fireAt = d;
        }
        if (typeof args.repeat === "string") {
          const r = args.repeat.toLowerCase();
          if (REPEAT_VALUES.includes(r as RepeatInterval)) {
            patch.repeat = r as RepeatInterval;
          }
        }

        if (Object.keys(patch).length === 0) {
          return "Error: provide at least one field to update (prompt, fire_at, or repeat).";
        }

        const updated = service.update(id, tenant.chatId, patch);
        if (!updated) return `Reminder ${id} not found in this chat.`;
        const local = new Date(updated.fireAt).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        });
        return `Reminder updated. ID: ${updated.id}. Fires ${local} (repeat: ${updated.repeat}).`;
      },
    },
    {
      name: "delete_reminder",
      description:
        "Delete (deactivate) a reminder by its ID. Use list_reminders first to get the ID if needed.",
      parameters: {
        type: "object",
        properties: {
          reminder_id: {
            type: "string",
            description: "The ID of the reminder to delete (e.g. rem_abc123).",
          },
        },
        required: ["reminder_id"],
      },
      execute: async (args, tenant) => {
        const id = String(args.reminder_id ?? "").trim();
        if (!id) return "Error: reminder_id is required.";
        const ok = service.delete(id, tenant.chatId);
        return ok ? `Reminder ${id} deleted.` : `Reminder ${id} not found in this chat.`;
      },
    },
  ];
}
