import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database | null = null;

/**
 * Lazy singleton — first call creates and migrates the DB.
 * Set process.env.DB_PATH = ":memory:" before first call in tests.
 */
export function getDb(): Database {
  if (_db) return _db;

  const path = process.env.DB_PATH ?? join(__dirname, "..", "data", "skye.db");

  if (path !== ":memory:") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  _db = new Database(path);
  _db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS memories (
      id         TEXT    PRIMARY KEY,
      chat_id    INTEGER NOT NULL,
      content    TEXT    NOT NULL,
      created_at TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_summaries (
      chat_id  INTEGER PRIMARY KEY,
      summary  TEXT    NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_configs (
      chat_id  INTEGER PRIMARY KEY,
      api_key  TEXT,
      base_url TEXT
    );

    CREATE TABLE IF NOT EXISTS request_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         TEXT    NOT NULL,
      chat_id    INTEGER NOT NULL,
      chat_type  TEXT    NOT NULL,
      thread_id  INTEGER,
      user_id    INTEGER NOT NULL,
      username   TEXT,
      first_name TEXT,
      msg_type   TEXT    NOT NULL,
      command    TEXT,
      input_len  INTEGER NOT NULL DEFAULT 0,
      output_len INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      model      TEXT    NOT NULL,
      status     TEXT    NOT NULL,
      error_msg  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_rl_ts      ON request_logs(ts);
    CREATE INDEX IF NOT EXISTS idx_rl_user_id ON request_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_rl_chat_id ON request_logs(chat_id);
  `);

  return _db;
}
