import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS background_jobs (
          id           TEXT PRIMARY KEY,
          kind         TEXT NOT NULL,
          payload      TEXT NOT NULL,
          status       TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
          run_at       TEXT NOT NULL,
          attempts     INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL,
          locked_at    TEXT,
          last_error   TEXT,
          created_at   TEXT NOT NULL,
          updated_at   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_background_jobs_due
          ON background_jobs(status, run_at);
        CREATE INDEX IF NOT EXISTS idx_background_jobs_kind
          ON background_jobs(kind, status);
      `);
    },
  },
];
