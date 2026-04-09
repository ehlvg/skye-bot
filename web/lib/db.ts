import Database from "better-sqlite3"
import { existsSync, mkdirSync } from "fs"
import { dirname, join, resolve } from "path"
import { WEB_CHAT_ID } from "./config"

let _db: Database.Database | null = null

export interface Thread {
  id: string
  name: string
  lastMessage: string | null
  lastMessageAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  threadId: string
  role: "user" | "assistant"
  content: string
  imageUrl: string | null
  createdAt: string
}

export interface Memory {
  id: string
  content: string
  createdAt: string
}

function generateId(prefix = ""): string {
  return (
    prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  )
}

export function getDb(): Database.Database {
  if (_db) return _db

  const dbPath =
    process.env.DB_PATH ??
    (existsSync(resolve(process.cwd(), "..", "data"))
      ? join(process.cwd(), "..", "data", "skye.db")
      : join(process.cwd(), "data", "skye.db"))

  const dir = dirname(dbPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  _db = new Database(dbPath)
  _db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

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

    CREATE TABLE IF NOT EXISTS web_threads (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS web_messages (
      id         TEXT PRIMARY KEY,
      thread_id  TEXT NOT NULL REFERENCES web_threads(id) ON DELETE CASCADE,
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      image_url  TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_wm_thread_id   ON web_messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_wm_created_at  ON web_messages(created_at);
  `)

  return _db
}

// ── Thread CRUD ─────────────────────────────────────────────────────────────

export function listThreads(): Thread[] {
  return getDb()
    .prepare(
      `SELECT
        t.id, t.name, t.created_at AS createdAt, t.updated_at AS updatedAt,
        m.content     AS lastMessage,
        m.created_at  AS lastMessageAt
       FROM web_threads t
       LEFT JOIN web_messages m ON m.id = (
         SELECT id FROM web_messages WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1
       )
       ORDER BY t.updated_at DESC`
    )
    .all() as Thread[]
}

export function createThread(name: string): Thread {
  const id = generateId("th_")
  const now = new Date().toISOString()
  getDb()
    .prepare(
      "INSERT INTO web_threads (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)"
    )
    .run(id, name, now, now)
  return {
    id,
    name,
    lastMessage: null,
    lastMessageAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

export function renameThread(id: string, name: string): boolean {
  const r = getDb()
    .prepare("UPDATE web_threads SET name = ?, updated_at = ? WHERE id = ?")
    .run(name, new Date().toISOString(), id)
  return r.changes > 0
}

export function deleteThread(id: string): boolean {
  const r = getDb().prepare("DELETE FROM web_threads WHERE id = ?").run(id)
  return r.changes > 0
}

export function getThread(id: string): Thread | null {
  return (
    (getDb()
      .prepare(
        "SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM web_threads WHERE id = ?"
      )
      .get(id) as Thread | undefined) ?? null
  )
}

// ── Message CRUD ─────────────────────────────────────────────────────────────

export function getMessages(threadId: string): Message[] {
  return getDb()
    .prepare(
      `SELECT id, thread_id AS threadId, role, content, image_url AS imageUrl, created_at AS createdAt
       FROM web_messages WHERE thread_id = ? ORDER BY created_at ASC`
    )
    .all(threadId) as Message[]
}

export function saveMessage(
  threadId: string,
  role: "user" | "assistant",
  content: string,
  imageUrl?: string | null
): Message {
  const id = generateId("msg_")
  const now = new Date().toISOString()
  const db = getDb()
  db.prepare(
    "INSERT INTO web_messages (id, thread_id, role, content, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, threadId, role, content, imageUrl ?? null, now)
  db.prepare("UPDATE web_threads SET updated_at = ? WHERE id = ?").run(
    now,
    threadId
  )
  return {
    id,
    threadId,
    role,
    content,
    imageUrl: imageUrl ?? null,
    createdAt: now,
  }
}

// ── Memory CRUD (web uses WEB_CHAT_ID) ───────────────────────────────────────

export function getWebMemories(): Memory[] {
  return getDb()
    .prepare(
      "SELECT id, content, created_at AS createdAt FROM memories WHERE chat_id = ? ORDER BY created_at ASC"
    )
    .all(WEB_CHAT_ID) as Memory[]
}

export function addWebMemory(content: string): Memory {
  const id = "mem_" + Math.random().toString(36).slice(2, 10)
  const now = new Date().toISOString()
  getDb()
    .prepare(
      "INSERT INTO memories (id, chat_id, content, created_at) VALUES (?, ?, ?, ?)"
    )
    .run(id, WEB_CHAT_ID, content, now)
  return { id, content, createdAt: now }
}

export function deleteWebMemory(id: string): boolean {
  const r = getDb()
    .prepare("DELETE FROM memories WHERE chat_id = ? AND id = ?")
    .run(WEB_CHAT_ID, id)
  return r.changes > 0
}
