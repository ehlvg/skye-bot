import type { PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { getDb } from "../../core/db.js";

export function buildRoutes(): PanelRoute[] {
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
  ];
}
