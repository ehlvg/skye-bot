import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { getDb } from "../../core/db.js";

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  const chatConfig = ctx.services.get("chatConfig");
  const audit = () => (ctx.services.has("audit") ? ctx.services.get("audit") : null);

  return [
    {
      method: "get",
      path: "/chat-config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const row = getDb()
          .prepare<[number], { chatId: number }>(
            `SELECT DISTINCT rl.chat_id AS chatId
             FROM request_logs rl
             WHERE rl.user_id = ? LIMIT 1`
          )
          .get(userId);

        if (!row) {
          res.json({ voiceMode: false });
          return;
        }
        const cfg = chatConfig.get(row.chatId);
        res.json({ voiceMode: cfg.voiceMode });
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
          if (body.voiceMode !== undefined) {
            audit()?.event({
              action: "voice_mode_changed",
              userId,
              chatId: row.chatId,
              details: { enabled: cfg.voiceMode },
            });
          }
          res.json({ voiceMode: cfg.voiceMode });
        } else {
          res.json({ voiceMode: body.voiceMode ?? false });
        }
      },
    },
  ];
}
