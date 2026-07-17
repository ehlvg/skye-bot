import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Logger } from "pino";

export type BackgroundJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface BackgroundJob<T = unknown> {
  id: string;
  kind: string;
  payload: T;
  status: BackgroundJobStatus;
  runAt: string;
  attempts: number;
  maxAttempts: number;
  lockedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueJobInput {
  id?: string;
  kind: string;
  payload: unknown;
  runAt?: Date;
  maxAttempts?: number;
}

export interface JobQueueDiagnostics {
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  handlers: string[];
  workerRunning: boolean;
}

export type BackgroundJobHandler = (job: BackgroundJob) => Promise<void> | void;

export interface BackgroundJobsService {
  register(kind: string, handler: BackgroundJobHandler): () => void;
  enqueue(input: EnqueueJobInput): { job: BackgroundJob; inserted: boolean };
  get(id: string): BackgroundJob | null;
  cancel(id: string): boolean;
  retry(id: string, runAt?: Date): boolean;
  diagnostics(): JobQueueDiagnostics;
  runOnce(): Promise<boolean>;
  start(): void;
  stop(): Promise<void>;
}

type JobRow = {
  id: string;
  kind: string;
  payload: string;
  status: BackgroundJobStatus;
  run_at: string;
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

const RETRY_BASE_MS = 15_000;
const RETRY_MAX_MS = 15 * 60_000;
const ERROR_LIMIT = 2000;

export class SqliteBackgroundJobs implements BackgroundJobsService {
  private readonly handlers = new Map<string, BackgroundJobHandler>();
  private timer: NodeJS.Timeout | null = null;
  private activeTick: Promise<void> | null = null;
  private started = false;
  private stopping = false;
  private lastCleanupAt = 0;

  constructor(
    private readonly db: Database.Database,
    private readonly settings: {
      enabled: boolean;
      pollIntervalMs: number;
      leaseSec: number;
      retentionDays: number;
    },
    private readonly logger?: Logger
  ) {}

  register(kind: string, handler: BackgroundJobHandler): () => void {
    const normalized = kind.trim();
    if (!normalized) throw new Error("Background job kind must not be empty");
    if (this.handlers.has(normalized)) {
      throw new Error(`Background job handler already registered: ${normalized}`);
    }
    this.handlers.set(normalized, handler);
    this.scheduleTick();
    return () => {
      if (this.handlers.get(normalized) === handler) this.handlers.delete(normalized);
    };
  }

  enqueue(input: EnqueueJobInput): { job: BackgroundJob; inserted: boolean } {
    const kind = input.kind.trim();
    if (!kind) throw new Error("Background job kind must not be empty");
    const maxAttempts = input.maxAttempts ?? 5;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
      throw new Error("Background job maxAttempts must be an integer between 1 and 100");
    }

    const id = input.id?.trim() || `job_${randomUUID()}`;
    const now = new Date().toISOString();
    const runAt = (input.runAt ?? new Date()).toISOString();
    const payload = JSON.stringify(input.payload ?? null);
    if (payload === undefined) throw new Error("Background job payload must be JSON-serializable");
    const result = this.db
      .prepare(
        `INSERT INTO background_jobs
           (id, kind, payload, status, run_at, attempts, max_attempts, locked_at, last_error, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', ?, 0, ?, NULL, NULL, ?, ?)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(id, kind, payload, runAt, maxAttempts, now, now);

    const job = this.get(id);
    if (!job) throw new Error(`Failed to read background job after enqueue: ${id}`);
    if (result.changes > 0) this.scheduleTick();
    return { job, inserted: result.changes > 0 };
  }

  get(id: string): BackgroundJob | null {
    const row = this.db
      .prepare<[string], JobRow>("SELECT * FROM background_jobs WHERE id = ?")
      .get(id);
    return row ? this.toJob(row) : null;
  }

  cancel(id: string): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE background_jobs
         SET status = 'cancelled', locked_at = NULL, updated_at = ?
         WHERE id = ? AND status IN ('queued', 'failed')`
      )
      .run(now, id);
    return result.changes > 0;
  }

  retry(id: string, runAt: Date = new Date()): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE background_jobs
         SET status = 'queued', run_at = ?, attempts = 0, locked_at = NULL,
             last_error = NULL, updated_at = ?
         WHERE id = ? AND status = 'failed'`
      )
      .run(runAt.toISOString(), now, id);
    if (result.changes > 0) this.scheduleTick();
    return result.changes > 0;
  }

  diagnostics(): JobQueueDiagnostics {
    const rows = this.db
      .prepare<
        [],
        { status: BackgroundJobStatus; count: number }
      >("SELECT status, COUNT(*) AS count FROM background_jobs GROUP BY status")
      .all();
    const counts: Record<BackgroundJobStatus, number> = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of rows) counts[row.status] = row.count;
    return {
      ...counts,
      handlers: [...this.handlers.keys()].sort(),
      workerRunning: this.started,
    };
  }

  start(): void {
    if (!this.settings.enabled || this.started) return;
    this.started = true;
    this.stopping = false;
    this.timer = setInterval(() => this.scheduleTick(), this.settings.pollIntervalMs);
    this.timer.unref();
    this.scheduleTick();
    this.logger?.info(
      { pollIntervalMs: this.settings.pollIntervalMs, leaseSec: this.settings.leaseSec },
      "Background job worker started"
    );
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.activeTick;
  }

  async runOnce(): Promise<boolean> {
    const job = this.claimNext();
    if (!job) return false;
    const handler = this.handlers.get(job.kind);
    if (!handler) return false;

    try {
      await handler(job);
      this.finish(job.id, "succeeded");
      this.logger?.info(
        { jobId: job.id, kind: job.kind, attempts: job.attempts },
        "Background job succeeded"
      );
    } catch (error) {
      const message = this.errorMessage(error);
      if (job.attempts >= job.maxAttempts) {
        this.finish(job.id, "failed", message);
        this.logger?.error(
          { jobId: job.id, kind: job.kind, attempts: job.attempts, error: message },
          "Background job exhausted retries"
        );
      } else {
        const delayMs = Math.min(RETRY_BASE_MS * 2 ** (job.attempts - 1), RETRY_MAX_MS);
        this.rescheduleAfterFailure(job.id, new Date(Date.now() + delayMs), message);
        this.logger?.warn(
          { jobId: job.id, kind: job.kind, attempts: job.attempts, delayMs, error: message },
          "Background job scheduled for retry"
        );
      }
    }
    return true;
  }

  private scheduleTick(): void {
    if (!this.started || this.stopping || this.activeTick) return;
    this.activeTick = this.drain()
      .catch((error) => this.logger?.error({ error }, "Background job worker tick failed"))
      .finally(() => {
        this.activeTick = null;
      });
  }

  private async drain(): Promise<void> {
    this.cleanup();
    for (let processed = 0; processed < 10 && !this.stopping; processed += 1) {
      if (!(await this.runOnce())) break;
    }
  }

  private claimNext(): BackgroundJob | null {
    const kinds = [...this.handlers.keys()];
    if (kinds.length === 0) return null;
    const now = new Date();
    const staleBefore = new Date(now.getTime() - this.settings.leaseSec * 1000).toISOString();
    const placeholders = kinds.map(() => "?").join(", ");
    const claim = this.db.transaction(() => {
      const row = this.db
        .prepare<string[], JobRow>(
          `SELECT * FROM background_jobs
           WHERE kind IN (${placeholders})
             AND ((status = 'queued' AND run_at <= ?)
               OR (status = 'running' AND (locked_at IS NULL OR locked_at <= ?)))
           ORDER BY run_at ASC, created_at ASC
           LIMIT 1`
        )
        .get(...[...kinds, now.toISOString(), staleBefore]);
      if (!row) return null;
      const updatedAt = now.toISOString();
      const result = this.db
        .prepare(
          `UPDATE background_jobs
           SET status = 'running', attempts = attempts + 1, locked_at = ?, updated_at = ?
           WHERE id = ?
             AND ((status = 'queued' AND run_at <= ?)
               OR (status = 'running' AND (locked_at IS NULL OR locked_at <= ?)))`
        )
        .run(updatedAt, updatedAt, row.id, updatedAt, staleBefore);
      if (result.changes === 0) return null;
      return (
        this.db
          .prepare<[string], JobRow>("SELECT * FROM background_jobs WHERE id = ?")
          .get(row.id) ?? null
      );
    });
    const row = claim();
    return row ? this.toJob(row) : null;
  }

  private finish(id: string, status: "succeeded" | "failed", lastError?: string): void {
    this.db
      .prepare(
        `UPDATE background_jobs
         SET status = ?, locked_at = NULL, last_error = ?, updated_at = ?
         WHERE id = ? AND status = 'running'`
      )
      .run(status, lastError ?? null, new Date().toISOString(), id);
  }

  private rescheduleAfterFailure(id: string, runAt: Date, lastError: string): void {
    this.db
      .prepare(
        `UPDATE background_jobs
         SET status = 'queued', run_at = ?, locked_at = NULL, last_error = ?, updated_at = ?
         WHERE id = ? AND status = 'running'`
      )
      .run(runAt.toISOString(), lastError, new Date().toISOString(), id);
  }

  private cleanup(): void {
    const now = Date.now();
    if (now - this.lastCleanupAt < 60 * 60_000) return;
    this.lastCleanupAt = now;
    const cutoff = new Date(now - this.settings.retentionDays * 24 * 60 * 60_000).toISOString();
    this.db
      .prepare(
        "DELETE FROM background_jobs WHERE status IN ('succeeded', 'cancelled') AND updated_at < ?"
      )
      .run(cutoff);
  }

  private toJob(row: JobRow): BackgroundJob {
    return {
      id: row.id,
      kind: row.kind,
      payload: JSON.parse(row.payload) as unknown,
      status: row.status,
      runAt: row.run_at,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      ...(row.locked_at ? { lockedAt: row.locked_at } : {}),
      ...(row.last_error ? { lastError: row.last_error } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, ERROR_LIMIT);
  }
}
