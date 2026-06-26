import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_configs (
          chat_id    INTEGER PRIMARY KEY,
          api_key    TEXT,
          base_url   TEXT,
          fast_mode  INTEGER NOT NULL DEFAULT 0,
          voice_mode INTEGER NOT NULL DEFAULT 0
        );
      `);
    },
  },
  {
    // Backfill for DBs created before fast_mode / voice_mode existed —
    // 001-init is a no-op on those because the table already exists.
    id: "002-backfill-mode-columns",
    up: (db) => {
      const cols = new Set(
        (db.pragma("table_info(chat_configs)") as { name: string }[]).map((c) => c.name)
      );
      if (!cols.has("fast_mode")) {
        db.exec("ALTER TABLE chat_configs ADD COLUMN fast_mode  INTEGER NOT NULL DEFAULT 0");
      }
      if (!cols.has("voice_mode")) {
        db.exec("ALTER TABLE chat_configs ADD COLUMN voice_mode INTEGER NOT NULL DEFAULT 0");
      }
    },
  },
  {
    // Fast-mode feature removed. Drop the column where supported (SQLite ≥ 3.35),
    // otherwise leave it orphaned — the service no longer reads or writes it.
    id: "003-drop-fast-mode",
    up: (db) => {
      const cols = new Set(
        (db.pragma("table_info(chat_configs)") as { name: string }[]).map((c) => c.name)
      );
      if (!cols.has("fast_mode")) return;
      try {
        db.exec("ALTER TABLE chat_configs DROP COLUMN fast_mode");
      } catch {
        // Older SQLite without DROP COLUMN — the orphan column is harmless.
      }
    },
  },
  {
    // Per-chat provider config (BYOK) is removed in the SaaS model.
    id: "004-drop-provider-columns",
    up: (db) => {
      const cols = new Set(
        (db.pragma("table_info(chat_configs)") as { name: string }[]).map((c) => c.name)
      );
      for (const col of ["api_key", "base_url"]) {
        if (!cols.has(col)) continue;
        try {
          db.exec(`ALTER TABLE chat_configs DROP COLUMN ${col}`);
        } catch {
          // Older SQLite — leave the orphan column.
        }
      }
    },
  },
];
