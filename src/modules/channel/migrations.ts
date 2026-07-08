import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS channel_posts (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id      INTEGER NOT NULL,
          message_id   INTEGER NOT NULL,
          sender       TEXT,
          text         TEXT,
          media_type   TEXT,
          media_caption TEXT,
          created_at   TEXT    NOT NULL,
          edited_at    TEXT,
          deleted_at   TEXT,
          UNIQUE(chat_id, message_id)
        );
        CREATE INDEX IF NOT EXISTS idx_channel_posts_chat
          ON channel_posts(chat_id, id);
        CREATE INDEX IF NOT EXISTS idx_channel_posts_message
          ON channel_posts(chat_id, message_id);
      `);
    },
  },
];
