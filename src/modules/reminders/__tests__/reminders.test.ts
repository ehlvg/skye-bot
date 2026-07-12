import { test, expect, describe, beforeEach } from "vitest";
import { resetDbForTesting, getDb, runMigrations } from "../../../core/db.js";
import { remindersModule } from "../index.js";
import { remindersService } from "../service.js";

beforeEach(() => {
  resetDbForTesting();
  process.env.DB_PATH = ":memory:";
  runMigrations(getDb(), [remindersModule]);
});

describe("reminders service", () => {
  const CHAT = 5001;

  test("create and retrieve a reminder", () => {
    const fireAt = new Date(Date.now() + 60_000);
    const r = remindersService.create(CHAT, "Call the dentist", fireAt);

    expect(r.id).toMatch(/^rem_/);
    expect(r.chatId).toBe(CHAT);
    expect(r.prompt).toBe("Call the dentist");
    expect(r.active).toBe(true);
    expect(r.repeat).toBe("none");

    const fetched = remindersService.get(r.id, CHAT);
    expect(fetched).toBeDefined();
    expect(fetched!.prompt).toBe("Call the dentist");
  });

  test("list reminders for a chat", () => {
    const now = Date.now();
    remindersService.create(CHAT, "First", new Date(now + 60_000));
    remindersService.create(CHAT, "Second", new Date(now + 120_000));

    const list = remindersService.list(CHAT);
    expect(list).toHaveLength(2);
    expect(list[0].prompt).toBe("First");
    expect(list[1].prompt).toBe("Second");
  });

  test("counts only active reminders owned by a user", () => {
    const first = remindersService.create(CHAT, "First", new Date(Date.now() + 60_000), {
      userId: 42,
    });
    remindersService.create(CHAT + 1, "Second", new Date(Date.now() + 60_000), { userId: 42 });
    remindersService.create(CHAT, "Other", new Date(Date.now() + 60_000), { userId: 43 });
    remindersService.deactivate(first.id);
    expect(remindersService.countActiveByUser(42)).toBe(1);
  });

  test("delete a reminder", () => {
    const r = remindersService.create(CHAT, "Delete me", new Date(Date.now() + 60_000));
    const ok = remindersService.delete(r.id, CHAT);
    expect(ok).toBe(true);

    const list = remindersService.list(CHAT);
    expect(list).toHaveLength(0);

    const ok2 = remindersService.delete(r.id, CHAT);
    expect(ok2).toBe(false);
  });

  test("update a reminder", () => {
    const r = remindersService.create(CHAT, "Original", new Date(Date.now() + 60_000));
    const updated = remindersService.update(r.id, CHAT, {
      prompt: "Updated prompt",
      fireAt: new Date(Date.now() + 120_000),
      repeat: "daily",
    });

    expect(updated).toBeDefined();
    expect(updated!.prompt).toBe("Updated prompt");
    expect(updated!.repeat).toBe("daily");
  });

  test("due reminders", () => {
    const past = new Date(Date.now() - 10_000);
    const future = new Date(Date.now() + 60_000);

    remindersService.create(CHAT, "Past", past);
    remindersService.create(CHAT, "Future", future);

    const due = remindersService.due();
    expect(due).toHaveLength(1);
    expect(due[0].prompt).toBe("Past");
  });

  test("advanceRepeating for daily", () => {
    const r = remindersService.create(CHAT, "Daily task", new Date(Date.now() - 10_000), {
      repeat: "daily",
    });
    const next = remindersService.advanceRepeating(r);
    expect(next).not.toBeNull();
    expect(next!.getTime()).toBeGreaterThan(Date.now());
  });

  test("advanceRepeating for none returns null", () => {
    const r = remindersService.create(CHAT, "One-time", new Date(Date.now() + 60_000));
    const next = remindersService.advanceRepeating(r);
    expect(next).toBeNull();
  });

  test("deactivate and reschedule", () => {
    const r = remindersService.create(CHAT, "Task", new Date(Date.now() - 10_000), {
      repeat: "daily",
    });
    const next = remindersService.advanceRepeating(r)!;
    remindersService.reschedule(r.id, next);

    const stillActive = remindersService.get(r.id, CHAT);
    expect(stillActive).toBeDefined();
    expect(new Date(stillActive!.fireAt).getTime()).toBeGreaterThan(Date.now());

    remindersService.deactivate(r.id);
    expect(remindersService.get(r.id, CHAT)).toBeNull();
  });

  test("reminder with threadId and userId", () => {
    const r = remindersService.create(CHAT, "Thread task", new Date(Date.now() + 60_000), {
      threadId: 42,
      userId: 999,
    });
    expect(r.threadId).toBe(42);
    expect(r.userId).toBe(999);
  });
});
