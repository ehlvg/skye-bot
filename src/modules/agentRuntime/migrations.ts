import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-thread-agents",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS chat_thread_agents (
          chat_id    INTEGER NOT NULL,
          thread_id  INTEGER NOT NULL DEFAULT 0,
          agent_id   TEXT    NOT NULL,
          updated_at TEXT    NOT NULL,
          PRIMARY KEY (chat_id, thread_id)
        );
      `);
    },
  },
  {
    id: "002-user-agents",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_agents (
          owner_user_id INTEGER NOT NULL,
          id            TEXT    NOT NULL,
          name          TEXT    NOT NULL,
          description   TEXT    NOT NULL,
          instructions  TEXT    NOT NULL,
          model_id      TEXT,
          created_at    TEXT    NOT NULL,
          updated_at    TEXT    NOT NULL,
          PRIMARY KEY (owner_user_id, id)
        );

        CREATE TABLE IF NOT EXISTS user_thread_agents (
          owner_user_id INTEGER NOT NULL,
          chat_id       INTEGER NOT NULL,
          thread_id     INTEGER NOT NULL DEFAULT 0,
          agent_id      TEXT    NOT NULL,
          updated_at    TEXT    NOT NULL,
          PRIMARY KEY (owner_user_id, chat_id, thread_id),
          FOREIGN KEY (owner_user_id, agent_id)
            REFERENCES user_agents(owner_user_id, id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    id: "003-user-agent-drafts",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_agent_drafts (
          owner_user_id INTEGER NOT NULL,
          chat_id       INTEGER NOT NULL,
          thread_id     INTEGER NOT NULL DEFAULT 0,
          step          TEXT    NOT NULL,
          name          TEXT,
          description   TEXT,
          instructions  TEXT,
          model_id      TEXT,
          updated_at    TEXT    NOT NULL,
          PRIMARY KEY (owner_user_id, chat_id, thread_id)
        );
      `);
    },
  },
  {
    id: "004-user-agent-models",
    up: (db) => {
      const agentColumns = new Set(
        (db.pragma("table_info(user_agents)") as { name: string }[]).map((column) => column.name)
      );
      if (!agentColumns.has("model_id")) {
        db.exec("ALTER TABLE user_agents ADD COLUMN model_id TEXT");
      }
      const draftColumns = new Set(
        (db.pragma("table_info(user_agent_drafts)") as { name: string }[]).map(
          (column) => column.name
        )
      );
      if (!draftColumns.has("model_id")) {
        db.exec("ALTER TABLE user_agent_drafts ADD COLUMN model_id TEXT");
      }
    },
  },
];
