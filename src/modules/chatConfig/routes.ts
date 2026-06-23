import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { getDb } from "../../core/db.js";

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  const chatConfig = ctx.services.get("chatConfig");

  return [
    {
      method: "get",
      path: "/chat-config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const row = getDb()
          .prepare<[number], { chatId: number; voiceMode: number }>(
            `SELECT DISTINCT rl.chat_id AS chatId, cg.voice_mode AS voiceMode
             FROM request_logs rl
             INNER JOIN chat_configs cg ON rl.chat_id = cg.chat_id
             WHERE rl.user_id = ? LIMIT 1`
          )
          .get(userId);

        if (!row) {
          res.json({ voiceMode: false });
          return;
        }
        res.json({ voiceMode: row.voiceMode === 1 });
      },
    },
    {
      method: "put",
      path: "/chat-config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const body = req.body as { voiceMode?: boolean };

        const row = getDb()
          .prepare<
            [number],
            { chatId: number }
          >(`SELECT DISTINCT chat_id AS chatId FROM request_logs WHERE user_id = ? LIMIT 1`)
          .get(userId);

        if (row) {
          if (body.voiceMode !== undefined) chatConfig.setVoiceMode(row.chatId, body.voiceMode);
          const cfg = chatConfig.get(row.chatId);
          res.json({ voiceMode: cfg.voiceMode });
        } else {
          res.json({ voiceMode: body.voiceMode ?? false });
        }
      },
    },
  ];
}
