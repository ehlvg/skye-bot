import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { getDb } from "../../core/db.js";

function json(value: string | null): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  return [
    {
      method: "get",
      path: "/stats",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const today = new Date().toISOString().slice(0, 10);

        const total = getDb()
          .prepare<
            [number],
            { count: number }
          >(`SELECT COUNT(*) as count FROM request_logs WHERE user_id = ?`)
          .get(userId);

        const todayCount = getDb()
          .prepare<
            [number, string],
            { count: number }
          >(`SELECT COUNT(*) as count FROM request_logs WHERE user_id = ? AND ts LIKE ?`)
          .get(userId, `${today}%`);

        const avgLatency = getDb()
          .prepare<
            [number],
            { avg: number }
          >(`SELECT AVG(latency_ms) as avg FROM request_logs WHERE user_id = ?`)
          .get(userId);

        const errors = getDb()
          .prepare<
            [number],
            { count: number }
          >(`SELECT COUNT(*) as count FROM request_logs WHERE user_id = ? AND status = 'error'`)
          .get(userId);

        const totalReqs = total?.count ?? 0;
        res.json({
          totalRequests: totalReqs,
          requestsToday: todayCount?.count ?? 0,
          avgLatencyMs: avgLatency?.avg ?? 0,
          errorRate: totalReqs > 0 ? (errors?.count ?? 0) / totalReqs : 0,
        });
      },
    },
    {
      method: "get",
      path: "/audit/events",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        const admin = ctx.services.get("admin");
        if (!admin.isAdmin(panelReq.initData.user.id)) {
          res.status(403).json({ error: "Administrator access required" });
          return;
        }

        const rows = getDb()
          .prepare<[], {
            ts: string;
            kind: "request" | "activity" | "billing";
            id: number;
            userId: number;
            chatId: number | null;
            action: string;
            model: string | null;
            status: string | null;
            latencyMs: number | null;
            inputText: string | null;
            outputText: string | null;
            toolCalls: string | null;
            details: string | null;
            error: string | null;
          }>(
            `SELECT * FROM (
              SELECT ts, 'request' AS kind, id, user_id AS userId, chat_id AS chatId,
                msg_type AS action, model, status, latency_ms AS latencyMs,
                input_text AS inputText, output_text AS outputText, tool_calls AS toolCalls,
                NULL AS details, error_msg AS error
              FROM request_logs
              UNION ALL
              SELECT ts, 'activity' AS kind, id, user_id AS userId, chat_id AS chatId,
                action, NULL AS model, NULL AS status, NULL AS latencyMs,
                NULL AS inputText, NULL AS outputText, NULL AS toolCalls, details, NULL AS error
              FROM audit_events
              UNION ALL
              SELECT created_at AS ts, 'billing' AS kind, id, user_id AS userId, NULL AS chatId,
                type AS action, NULL AS model, NULL AS status, NULL AS latencyMs,
                NULL AS inputText, NULL AS outputText, NULL AS toolCalls, payload AS details, NULL AS error
              FROM billing_events
            ) ORDER BY ts DESC LIMIT 200`
          )
          .all();

        res.json(
          rows.map((row) => ({
            ...row,
            toolCalls: json(row.toolCalls),
            details: json(row.details),
          }))
        );
      },
    },
  ];
}
