import { getDb } from "../../core/db.js";
import { log } from "../../utils/log.js";

export type MsgType =
  | "text"
  | "voice"
  | "photo"
  | "image"
  | "image_edit"
  | "document"
  | "audio"
  | "video_note";

export interface AuditEntry {
  chatId: number;
  chatType: string;
  threadId?: number;
  userId: number;
  username?: string;
  firstName?: string;
  msgType: MsgType;
  command?: string;
  inputLen: number;
  outputLen: number;
  latencyMs: number;
  status: "ok" | "error";
  errorMsg?: string;
}

const RETENTION_DAYS = Number(process.env.AUDIT_RETENTION_DAYS ?? "90");
const MAX_ROWS = Number(process.env.AUDIT_MAX_ROWS ?? "100000");

export function logRequest(entry: AuditEntry, model: string): void {
  try {
    getDb()
      .prepare(
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
        model,
        entry.status,
        entry.errorMsg ?? null
      );
  } catch (e) {
    log.error({ err: e }, "Failed to write audit log entry");
  }
}

export function pruneAuditLog(): { byAge: number; byCount: number } {
  const db = getDb();
  const byAge = db
    .prepare(`DELETE FROM request_logs WHERE ts < datetime('now', '-${RETENTION_DAYS} days')`)
    .run();
  const byCount = db
    .prepare(
      `DELETE FROM request_logs
       WHERE id NOT IN (SELECT id FROM request_logs ORDER BY id DESC LIMIT ${MAX_ROWS})`
    )
    .run();
  return { byAge: byAge.changes, byCount: byCount.changes };
}

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

export interface AuditService {
  log(entry: AuditEntry): void;
}
