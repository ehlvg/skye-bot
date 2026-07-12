import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
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
    },
  },
  {
    id: "002-content-and-events",
    up: (db) => {
      db.exec(`
        ALTER TABLE request_logs ADD COLUMN input_text TEXT;
        ALTER TABLE request_logs ADD COLUMN output_text TEXT;
        ALTER TABLE request_logs ADD COLUMN tool_calls TEXT;

        CREATE TABLE IF NOT EXISTS audit_events (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          ts         TEXT    NOT NULL,
          user_id    INTEGER NOT NULL,
          chat_id    INTEGER,
          action     TEXT    NOT NULL,
          details    TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_ae_ts ON audit_events(ts);
        CREATE INDEX IF NOT EXISTS idx_ae_user_id ON audit_events(user_id);
      `);
    },
  },
];
