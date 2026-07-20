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
  {
    id: "003-group-message-log",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS group_messages (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          chat_id      INTEGER NOT NULL,
          message_id   INTEGER,
          sender       TEXT    NOT NULL,
          timestamp    TEXT    NOT NULL,
          type         TEXT    NOT NULL,
          content      TEXT    NOT NULL,
          reply_to     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_group_messages_chat
          ON group_messages(chat_id, id);
        CREATE INDEX IF NOT EXISTS idx_group_messages_message
          ON group_messages(chat_id, message_id);
      `);
    },
  },
  {
    id: "004-group-message-threads",
    up: (db) => {
      const cols = new Set(
        (db.pragma("table_info(group_messages)") as { name: string }[]).map((c) => c.name)
      );
      if (!cols.has("thread_id")) {
        db.exec("ALTER TABLE group_messages ADD COLUMN thread_id INTEGER");
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_group_messages_thread
          ON group_messages(chat_id, thread_id, id);
      `);
    },
  },
];
