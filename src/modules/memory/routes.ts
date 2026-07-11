import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { getDb } from "../../core/db.js";

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  void ctx;
  return [
    {
      method: "get",
      path: "/memories",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        // Cross-reference request_logs to find chats this user participated in.
        const rows = getDb()
          .prepare<[number], { id: string; content: string; createdAt: string; chatId: number }>(
            `SELECT m.id, m.content, m.created_at AS createdAt, m.chat_id AS chatId
             FROM memories m
             WHERE m.chat_id IN (SELECT DISTINCT chat_id FROM request_logs WHERE user_id = ?)
             ORDER BY m.created_at DESC LIMIT 100`
          )
          .all(userId);
        res.json(rows);
      },
    },
    {
      method: "delete",
      path: "/memories/:chatId/:id",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const chatId = Number(req.params.chatId);
        const id = String(req.params.id);
        if (!Number.isSafeInteger(chatId)) {
          res.status(400).json({ error: "Invalid chat ID" });
          return;
        }
        const result = getDb()
          .prepare(
            `DELETE FROM memories WHERE chat_id = ? AND id = ?
             AND EXISTS (SELECT 1 FROM request_logs WHERE user_id = ? AND chat_id = memories.chat_id)`
          )
          .run(chatId, id, userId);
        if (result.changes === 0) {
          res.status(404).json({ error: "Memory not found" });
          return;
        }
        res.json({ ok: true });
      },
    },
    {
      method: "delete",
      path: "/memories/:chatId",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const chatId = Number(req.params.chatId);
        if (!Number.isSafeInteger(chatId)) {
          res.status(400).json({ error: "Invalid chat ID" });
          return;
        }
        const authorized = getDb()
          .prepare(`SELECT 1 FROM request_logs WHERE user_id = ? AND chat_id = ? LIMIT 1`)
          .get(userId, chatId);
        if (!authorized) {
          res.status(404).json({ error: "Memories not found" });
          return;
        }
        getDb().prepare(`DELETE FROM memories WHERE chat_id = ?`).run(chatId);
        res.json({ ok: true });
      },
    },
  ];
}
