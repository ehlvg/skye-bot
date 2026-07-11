import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
          id         TEXT    PRIMARY KEY,
          chat_id    INTEGER NOT NULL,
          content    TEXT    NOT NULL,
          created_at TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memories_chat ON memories(chat_id);
      `);
    },
  },
  {
    id: "002-memory-management",
    up: (db) => {
      db.exec(`
        ALTER TABLE memories ADD COLUMN category TEXT NOT NULL DEFAULT 'fact';
        ALTER TABLE memories ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE memories ADD COLUMN last_used_at TEXT;
        ALTER TABLE memories ADD COLUMN expires_at TEXT;
        ALTER TABLE memories ADD COLUMN archived_at TEXT;
        UPDATE memories SET updated_at = created_at WHERE updated_at = '';
        CREATE INDEX IF NOT EXISTS idx_memories_active
          ON memories(chat_id, category, expires_at, archived_at);
        CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(chat_id, updated_at);
      `);
    },
  },
];
