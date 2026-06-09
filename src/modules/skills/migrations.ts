import type { Migration } from "../../core/module.js";

export const skillsMigrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_skills (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL,
          name       TEXT    NOT NULL,
          enabled    INTEGER NOT NULL DEFAULT 1,
          created_at TEXT    NOT NULL,
          UNIQUE(user_id, name)
        );
        CREATE INDEX IF NOT EXISTS idx_uskills_user_id ON user_skills(user_id);
      `);
    },
  },
];
