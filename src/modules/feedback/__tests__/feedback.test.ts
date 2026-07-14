import { beforeEach, describe, expect, test } from "vitest";
import { getDb, resetDbForTesting, runMigrations } from "../../../core/db.js";
import { feedbackModule } from "../index.js";
import { FeedbackService } from "../service.js";

beforeEach(() => {
  resetDbForTesting();
  process.env.DB_PATH = ":memory:";
  runMigrations(getDb(), [feedbackModule]);
});

describe("FeedbackService", () => {
  const service = new FeedbackService();

  test("creates one vote and treats a repeated vote as unchanged", () => {
    expect(service.record(100, 200, 300, 1)).toBe("created");
    expect(service.record(100, 200, 300, 1)).toBe("unchanged");
    expect(service.stats().allTime).toEqual({
      total: 1,
      positive: 1,
      negative: 0,
      uniqueUsers: 1,
    });
  });

  test("lets a user replace an earlier vote", () => {
    service.record(100, 200, 300, 1);
    expect(service.record(100, 200, 300, -1)).toBe("updated");
    expect(service.stats().allTime).toMatchObject({ total: 1, positive: 0, negative: 1 });
  });

  test("keeps votes separate by chat, answer and user", () => {
    service.record(100, 200, 300, 1);
    service.record(100, 200, 301, -1);
    service.record(100, 201, 300, 1);
    service.record(101, 200, 300, -1);

    expect(service.stats().allTime).toEqual({
      total: 4,
      positive: 2,
      negative: 2,
      uniqueUsers: 2,
    });
  });

  test("separates recent feedback from older feedback", () => {
    service.record(100, 200, 300, 1);
    service.record(100, 201, 301, -1);
    getDb()
      .prepare(
        "UPDATE response_feedback SET updated_at = datetime('now', '-31 days') WHERE message_id = ?"
      )
      .run(200);

    expect(service.stats().last30Days).toEqual({
      total: 1,
      positive: 0,
      negative: 1,
      uniqueUsers: 1,
    });
  });
});
