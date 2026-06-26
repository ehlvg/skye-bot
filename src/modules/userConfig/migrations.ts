import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_configs (
          user_id       INTEGER PRIMARY KEY,
          api_key       TEXT,
          base_url      TEXT,
          model         TEXT,
          max_tokens    INTEGER,
          system_prompt TEXT
        );

        CREATE TABLE IF NOT EXISTS user_mcp_servers (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER NOT NULL,
          name       TEXT    NOT NULL,
          config     TEXT    NOT NULL,
          created_at TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_umcp_user_id ON user_mcp_servers(user_id);

        CREATE TABLE IF NOT EXISTS user_mcp_inputs (
          server_id  INTEGER NOT NULL,
          input_id   TEXT    NOT NULL,
          value      TEXT    NOT NULL,
          PRIMARY KEY (server_id, input_id)
        );
      `);
    },
  },
  {
    // Skye is now SaaS-first: per-user provider config (BYOK) is removed.
    // Drop the now-unused columns where the SQLite version supports it; on
    // older SQLite (<3.35) the orphan columns are harmless and unread.
    id: "002-drop-provider-columns",
    up: (db) => {
      const cols = new Set(
        (db.pragma("table_info(user_configs)") as { name: string }[]).map((c) => c.name)
      );
      for (const col of ["api_key", "base_url", "model", "max_tokens"]) {
        if (!cols.has(col)) continue;
        try {
          db.exec(`ALTER TABLE user_configs DROP COLUMN ${col}`);
        } catch {
          // Older SQLite — leave the orphan column.
        }
      }
    },
  },
];
