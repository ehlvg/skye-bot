import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS response_feedback (
          chat_id     INTEGER NOT NULL,
          message_id  INTEGER NOT NULL,
          user_id     INTEGER NOT NULL,
          rating      INTEGER NOT NULL CHECK (rating IN (-1, 1)),
          created_at  TEXT    NOT NULL,
          updated_at  TEXT    NOT NULL,
          PRIMARY KEY (chat_id, message_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_response_feedback_updated
          ON response_feedback(updated_at);
      `);
    },
  },
];
