import Database from "better-sqlite3";
import { mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const path = process.env.DB_PATH ?? join(__dirname, "..", "data", "skye.db");

  if (path !== ":memory:") {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  _db = new Database(path);
  _db.pragma("journal_mode = WAL");
  _db.exec(`
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
      chat_id    INTEGER PRIMARY KEY,
      api_key    TEXT,
      base_url   TEXT,
      fast_mode  INTEGER NOT NULL DEFAULT 0,
      voice_mode INTEGER NOT NULL DEFAULT 0
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

    CREATE TABLE IF NOT EXISTS user_configs (
      user_id      INTEGER PRIMARY KEY,
      api_key      TEXT,
      base_url     TEXT,
      model        TEXT,
      max_tokens   INTEGER,
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

  const cols = new Set(
    (_db.pragma("table_info(chat_configs)") as { name: string }[]).map((c) => c.name)
  );
  if (!cols.has("fast_mode"))
    _db.exec("ALTER TABLE chat_configs ADD COLUMN fast_mode  INTEGER NOT NULL DEFAULT 0");
  if (!cols.has("voice_mode"))
    _db.exec("ALTER TABLE chat_configs ADD COLUMN voice_mode INTEGER NOT NULL DEFAULT 0");

  return _db;
}
