import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_summaries (
          chat_id  INTEGER PRIMARY KEY,
          summary  TEXT    NOT NULL
        );
      `);
    },
  },
  {
    id: "002-conversation-items",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_items (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id      INTEGER NOT NULL,
          thread_key   TEXT    NOT NULL,
          message_id   INTEGER,
          role         TEXT    NOT NULL,
          content_json TEXT    NOT NULL,
          text         TEXT    NOT NULL,
          created_at   TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_conversation_items_thread
          ON conversation_items(chat_id, thread_key, id);
        CREATE INDEX IF NOT EXISTS idx_conversation_items_message
          ON conversation_items(chat_id, message_id);
      `);
    },
  },
];
