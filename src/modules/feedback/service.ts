import { getDb } from "../../core/db.js";

export type FeedbackRating = 1 | -1;
export type FeedbackWriteResult = "created" | "updated" | "unchanged";

export interface FeedbackStatsPeriod {
  total: number;
  positive: number;
  negative: number;
  uniqueUsers: number;
}

export interface FeedbackStats {
  allTime: FeedbackStatsPeriod;
  last30Days: FeedbackStatsPeriod;
}

type RatingRow = { rating: number };
type StatsRow = {
  total: number;
  positive: number;
  negative: number;
  unique_users: number;
};

function normalizeStats(row: StatsRow | undefined): FeedbackStatsPeriod {
  return {
    total: row?.total ?? 0,
    positive: row?.positive ?? 0,
    negative: row?.negative ?? 0,
    uniqueUsers: row?.unique_users ?? 0,
  };
}

export class FeedbackService {
  record(
    chatId: number,
    messageId: number,
    userId: number,
    rating: FeedbackRating
  ): FeedbackWriteResult {
    const db = getDb();
    const existing = db
      .prepare<[number, number, number], RatingRow>(
        `SELECT rating FROM response_feedback
         WHERE chat_id = ? AND message_id = ? AND user_id = ?`
      )
      .get(chatId, messageId, userId);

    if (existing?.rating === rating) return "unchanged";

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO response_feedback (
         chat_id, message_id, user_id, rating, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id, message_id, user_id) DO UPDATE SET
         rating = excluded.rating,
         updated_at = excluded.updated_at`
    ).run(chatId, messageId, userId, rating, now, now);

    return existing ? "updated" : "created";
  }

  stats(): FeedbackStats {
    const db = getDb();
    const select = (where = "") =>
      db
        .prepare<[], StatsRow>(
          `SELECT
             COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END), 0) AS positive,
             COALESCE(SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END), 0) AS negative,
             COUNT(DISTINCT user_id) AS unique_users
           FROM response_feedback ${where}`
        )
        .get();

    return {
      allTime: normalizeStats(select()),
      last30Days: normalizeStats(
        select("WHERE datetime(updated_at) >= datetime('now', '-30 days')")
      ),
    };
  }
}

export const feedbackService = new FeedbackService();
