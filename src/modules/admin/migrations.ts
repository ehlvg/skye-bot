import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS admin_allowlist (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          target_id  INTEGER NOT NULL,
          kind       TEXT    NOT NULL,  -- user | group | channel
          added_by   INTEGER NOT NULL,
          note       TEXT,
          created_at TEXT    NOT NULL,
          UNIQUE(target_id)
        );
        CREATE INDEX IF NOT EXISTS idx_admin_allowlist_target ON admin_allowlist(target_id);

        CREATE TABLE IF NOT EXISTS admin_banlist (
          target_id  INTEGER PRIMARY KEY,
          banned_by  INTEGER NOT NULL,
          created_at TEXT    NOT NULL
        );
      `);
    },
  },
];