import { getDb } from "./db.js";
import { MODEL } from "./config.js";
import { log } from "./utils/log.js";

export type MsgType = "text" | "voice" | "photo" | "image" | "image_edit";

export interface AuditEntry {
  chatId: number;
  chatType: string;
  threadId?: number;
  userId: number;
  username?: string;
  firstName?: string;
  msgType: MsgType;
  /** Set for /image and /image_edit */
  command?: string;
  /** Characters in user input (or recognized speech) */
  inputLen: number;
  /** Characters in text reply; 0 for binary outputs (images) */
  outputLen: number;
  latencyMs: number;
  status: "ok" | "error";
  errorMsg?: string;
}

// Configurable via env vars (read once at module init)
const RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? "90");
const MAX_ROWS = Number(process.env.AUDIT_MAX_ROWS ?? "100000");

/**
 * Write one audit entry. Silently swallows errors so audit failures
 * never affect the bot's response path.
 */
export function logRequest(entry: AuditEntry): void {
  try {
    getDb()
      .query(
        `INSERT INTO request_logs (
          ts, chat_id, chat_type, thread_id, user_id, username, first_name,
          msg_type, command, input_len, output_len, latency_ms, model, status, error_msg
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        entry.chatId,
        entry.chatType,
        entry.threadId ?? null,
        entry.userId,
        entry.username ?? null,
        entry.firstName ?? null,
        entry.msgType,
        entry.command ?? null,
        entry.inputLen,
        entry.outputLen,
        entry.latencyMs,
        MODEL,
        entry.status,
        entry.errorMsg ?? null
      );
  } catch (e) {
    log.error({ err: e }, "Failed to write audit log entry");
  }
}

/**
 * Delete rows that exceed retention limits.
 * Two independent guards:
 *   1. Age — rows older than RETENTION_DAYS days
 *   2. Count — keep only the newest MAX_ROWS rows
 */
export function pruneAuditLog(): { byAge: number; byCount: number } {
  const db = getDb();

  const byAge = db
    .query(`DELETE FROM request_logs WHERE ts < datetime('now', '-${RETENTION_DAYS} days')`)
    .run();

  const byCount = db
    .query(
      `DELETE FROM request_logs
       WHERE id NOT IN (SELECT id FROM request_logs ORDER BY id DESC LIMIT ${MAX_ROWS})`
    )
    .run();

  return { byAge: byAge.changes, byCount: byCount.changes };
}

/**
 * Run pruneAuditLog immediately (to catch leftover data on restart),
 * then schedule it every 24 hours. The interval is unref'd so it never
 * prevents the process from exiting cleanly.
 */
export function scheduleAuditPruning(): void {
  const run = () => {
    const { byAge, byCount } = pruneAuditLog();
    const total = byAge + byCount;
    if (total > 0) {
      log.info({ byAge, byCount }, `Audit log: pruned ${total} rows`);
    }
  };

  run();
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}
