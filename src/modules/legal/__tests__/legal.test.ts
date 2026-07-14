import { test, expect, describe, beforeEach } from "vitest";
import { deleteUserData, legalService } from "../service.js";
import { getDb } from "../../../core/db.js";

const USER = 424242;

function seed(userId: number): void {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO user_configs (user_id, system_prompt) VALUES (?, ?)"
  ).run(userId, "custom prompt");
  db.prepare(
    "INSERT INTO user_mcp_servers (user_id, name, config, created_at) VALUES (?, ?, ?, ?)"
  ).run(userId, "srv", "{}", now);
  db.prepare(
    "INSERT INTO user_mcp_inputs (server_id, input_id, value) VALUES (?, ?, ?)"
  ).run(1, "tok", "abc");

  db.prepare(
    `INSERT INTO billing_accounts
      (user_id, model_id, sub_status, sub_expires_at, sub_period_start,
       base_used_tokens, packs_tokens, total_used_tokens, last_charge_id,
       created_at, updated_at)
     VALUES (?, 'sydney', 'active', 0, 0, 0, 0, 0, NULL, ?, ?)`
  ).run(userId, now, now);
  db.prepare(
    "INSERT INTO billing_events (user_id, type, payload, amount, created_at) VALUES (?, 'token_spend', NULL, 1, ?)"
  ).run(userId, now);

  db.prepare(
    "INSERT INTO memories (id, chat_id, content, created_at) VALUES (?, ?, ?, ?)"
  ).run("mem_x", userId, "a memory", now);
  db.prepare(
    "INSERT INTO chat_summaries (chat_id, summary) VALUES (?, ?)"
  ).run(userId, "summary");
  db.prepare(
    `INSERT INTO conversation_items
      (chat_id, thread_key, message_id, role, content_json, text, created_at)
     VALUES (?, ?, NULL, 'user', '{}', 'hi', ?)`
  ).run(userId, String(userId), now);
  db.prepare(
    "INSERT INTO group_messages (chat_id, message_id, sender, timestamp, type, content, reply_to) VALUES (?, NULL, 'u', ?, 'text', 'hi', NULL)"
  ).run(userId, now);
  db.prepare(
    "INSERT INTO chat_configs (chat_id, voice_mode) VALUES (?, 1)"
  ).run(userId);
  db.prepare(
    "INSERT INTO reminders (id, chat_id, thread_id, user_id, prompt, fire_at, repeat, created_at, active) VALUES (?, ?, NULL, ?, 'x', ?, 'none', ?, 1)"
  ).run("rem_1", userId, userId, now, now);
  db.prepare(
    `INSERT INTO response_feedback
      (chat_id, message_id, user_id, rating, created_at, updated_at)
     VALUES (?, 123, ?, 1, ?, ?)`
  ).run(userId, userId, now, now);
  db.prepare(
    `INSERT INTO request_logs
      (ts, chat_id, chat_type, thread_id, user_id, username, first_name,
       msg_type, command, input_len, output_len, latency_ms, model, status, error_msg)
     VALUES (?, ?, 'private', NULL, ?, NULL, NULL, 'text', NULL, 1, 1, 1, 'sydney', 'ok', NULL)`
  ).run(now, userId, userId);
}

function counts(userId: number): Record<string, number> {
  const db = getDb();
  const byUser = [
    "user_configs",
    "user_mcp_servers",
    "billing_accounts",
    "billing_events",
    "reminders",
    "response_feedback",
    "request_logs",
  ];
  const byChat = ["memories", "chat_summaries", "conversation_items", "group_messages", "chat_configs"];
  const out: Record<string, number> = {};
  for (const t of byUser) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE user_id = ?`).get(userId) as { c: number };
    out[t] = row.c;
  }
  for (const t of byChat) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM ${t} WHERE chat_id = ?`).get(userId) as { c: number };
    out[t] = row.c;
  }
  const mcpInputs = db
    .prepare(
      `SELECT COUNT(*) AS c FROM user_mcp_inputs
       WHERE server_id IN (SELECT id FROM user_mcp_servers WHERE user_id = ?)`
    )
    .get(userId) as { c: number };
  out.user_mcp_inputs = mcpInputs.c;
  return out;
}

beforeEach(() => {
  const db = getDb();
  db.exec(`
    DELETE FROM user_mcp_inputs;
    DELETE FROM user_mcp_servers;
    DELETE FROM user_configs;
    DELETE FROM billing_events;
    DELETE FROM billing_accounts;
    DELETE FROM memories;
    DELETE FROM chat_summaries;
    DELETE FROM conversation_items;
    DELETE FROM group_messages;
    DELETE FROM chat_configs;
    DELETE FROM reminders;
    DELETE FROM response_feedback;
    DELETE FROM request_logs;
  `);
});

describe("deleteUserData", () => {
  test("wipes all per-user and private-chat data", () => {
    seed(USER);

    const summary = deleteUserData(USER);

    expect(summary.userConfigs).toBe(1);
    expect(summary.userMcpServers).toBe(1);
    expect(summary.userMcpInputs).toBe(1);
    expect(summary.billingAccounts).toBe(1);
    expect(summary.billingEvents).toBe(1);
    expect(summary.memories).toBe(1);
    expect(summary.chatSummaries).toBe(1);
    expect(summary.conversationItems).toBe(1);
    expect(summary.groupMessages).toBe(1);
    expect(summary.chatConfigs).toBe(1);
    expect(summary.reminders).toBe(1);
    expect(summary.responseFeedback).toBe(1);
    expect(summary.requestLogs).toBe(1);

    const after = counts(USER);
    for (const v of Object.values(after)) expect(v).toBe(0);
  });

  test("is a no-op for an unknown user", () => {
    const summary = deleteUserData(999999);
    for (const v of Object.values(summary)) expect(v).toBe(0);
  });

  test("is exposed on the LegalService", () => {
    expect(legalService.deleteUserData).toBe(deleteUserData);
  });
});
