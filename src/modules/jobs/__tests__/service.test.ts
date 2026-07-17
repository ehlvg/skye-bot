import Database from "better-sqlite3";
import { beforeEach, describe, expect, test } from "vitest";
import { runMigrations } from "../../../core/db.js";
import { jobsModule } from "../index.js";
import { SqliteBackgroundJobs } from "../service.js";

let db: Database.Database;
let jobs: SqliteBackgroundJobs;

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db, [jobsModule]);
  jobs = new SqliteBackgroundJobs(db, {
    enabled: true,
    pollIntervalMs: 1000,
    leaseSec: 30,
    retentionDays: 7,
  });
});

describe("SQLite background jobs", () => {
  test("executes a job and persists its result", async () => {
    const seen: unknown[] = [];
    jobs.register("test.echo", (job) => {
      seen.push(job.payload);
    });
    jobs.enqueue({ id: "job-1", kind: "test.echo", payload: { value: 42 } });

    expect(await jobs.runOnce()).toBe(true);
    expect(seen).toEqual([{ value: 42 }]);
    expect(jobs.get("job-1")).toMatchObject({ status: "succeeded", attempts: 1 });
  });

  test("deduplicates jobs by caller-provided id", () => {
    const first = jobs.enqueue({ id: "same", kind: "test.echo", payload: { version: 1 } });
    const second = jobs.enqueue({ id: "same", kind: "test.echo", payload: { version: 2 } });

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.job.payload).toEqual({ version: 1 });
  });

  test("retries failures and stops after maxAttempts", async () => {
    jobs.register("test.fail", () => {
      throw new Error("temporary outage");
    });
    jobs.enqueue({ id: "failing", kind: "test.fail", payload: null, maxAttempts: 2 });

    await jobs.runOnce();
    expect(jobs.get("failing")).toMatchObject({ status: "queued", attempts: 1 });

    db.prepare("UPDATE background_jobs SET run_at = ? WHERE id = ?").run(
      new Date(Date.now() - 1000).toISOString(),
      "failing"
    );
    await jobs.runOnce();
    expect(jobs.get("failing")).toMatchObject({
      status: "failed",
      attempts: 2,
      lastError: "temporary outage",
    });
  });

  test("recovers a running job after its lease expires", async () => {
    let calls = 0;
    jobs.register("test.recover", () => {
      calls += 1;
    });
    jobs.enqueue({ id: "abandoned", kind: "test.recover", payload: null });
    db.prepare("UPDATE background_jobs SET status = 'running', locked_at = ? WHERE id = ?").run(
      new Date(Date.now() - 60_000).toISOString(),
      "abandoned"
    );

    expect(await jobs.runOnce()).toBe(true);
    expect(calls).toBe(1);
    expect(jobs.get("abandoned")?.status).toBe("succeeded");
  });

  test("leaves jobs queued until their handler is registered", async () => {
    jobs.enqueue({ id: "waiting", kind: "test.later", payload: null });
    expect(await jobs.runOnce()).toBe(false);
    expect(jobs.get("waiting")?.status).toBe("queued");

    jobs.register("test.later", () => {});
    expect(await jobs.runOnce()).toBe(true);
  });

  test("allows an operator to retry a terminal failure", async () => {
    jobs.register("test.manual", () => {
      throw new Error("failed");
    });
    jobs.enqueue({ id: "manual", kind: "test.manual", payload: null, maxAttempts: 1 });
    await jobs.runOnce();

    expect(jobs.retry("manual")).toBe(true);
    expect(jobs.get("manual")).toMatchObject({ status: "queued", attempts: 0 });
    expect(jobs.cancel("manual")).toBe(true);
    expect(jobs.get("manual")?.status).toBe("cancelled");
  });
});
