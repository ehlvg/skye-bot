import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { getDb } from "../../core/db.js";
import { isVoiceReplyMode, type VoiceReplyMode } from "./service.js";

export function serializeChatConfig(mode: VoiceReplyMode): {
  voiceReplyMode: VoiceReplyMode;
  voiceMode: boolean;
} {
  return {
    voiceReplyMode: mode,
    voiceMode: mode === "always",
  };
}

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
          res.json(serializeChatConfig("text"));
          return;
        }
        const cfg = chatConfig.get(row.chatId);
        res.json(serializeChatConfig(cfg.voiceReplyMode));
      },
    },
    {
      method: "put",
      path: "/chat-config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const body = req.body as { voiceReplyMode?: unknown; voiceMode?: boolean };
        const requestedMode: VoiceReplyMode | undefined = isVoiceReplyMode(body.voiceReplyMode)
          ? body.voiceReplyMode
          : typeof body.voiceMode === "boolean"
            ? body.voiceMode
              ? "always"
              : "text"
            : undefined;

        if (body.voiceReplyMode !== undefined && !isVoiceReplyMode(body.voiceReplyMode)) {
          res.status(400).json({ error: "voiceReplyMode must be text, auto, or always" });
          return;
        }

        const row = getDb()
          .prepare<
            [number],
            { chatId: number }
          >(`SELECT DISTINCT chat_id AS chatId FROM request_logs WHERE user_id = ? LIMIT 1`)
          .get(userId);

        if (row) {
          if (requestedMode !== undefined) {
            chatConfig.setVoiceReplyMode(row.chatId, requestedMode);
          }
          const cfg = chatConfig.get(row.chatId);
          if (requestedMode !== undefined) {
            audit()?.event({
              action: "voice_mode_changed",
              userId,
              chatId: row.chatId,
              details: { mode: cfg.voiceReplyMode },
            });
          }
          res.json(serializeChatConfig(cfg.voiceReplyMode));
        } else {
          res.json(serializeChatConfig(requestedMode ?? "text"));
        }
      },
    },
  ];
}
