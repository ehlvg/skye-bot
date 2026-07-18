import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { UserConfig } from "./service.js";
import type { PanelRequest } from "../panel/index.js";

const MAX_SYSTEM_PROMPT_CHARS = 16_000;

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  const userConfig = ctx.services.get("userConfig");
  const audit = () => (ctx.services.has("audit") ? ctx.services.get("audit") : null);

  return [
    {
      method: "get",
      path: "/config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        res.json(userConfig.get(userId));
      },
    },
    {
      method: "put",
      path: "/config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const body = (req.body ?? {}) as Partial<UserConfig>;
        const clean: UserConfig = {};
        if (body.systemPrompt !== undefined) {
          if (
            typeof body.systemPrompt !== "string" ||
            body.systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS
          ) {
            res.status(400).json({
              error: `System prompt must be at most ${MAX_SYSTEM_PROMPT_CHARS} characters`,
            });
            return;
          }
          clean.systemPrompt = body.systemPrompt;
        }
        if (["skye", "skye.exe", "operator", "muse"].includes(body.personality ?? "")) {
          clean.personality = body.personality;
        }
        userConfig.set(userId, clean);
        audit()?.event({
          action: "settings_saved",
          userId,
          details: {
            changed: Object.keys(clean),
            ...(clean.personality ? { personality: clean.personality } : {}),
            ...(clean.systemPrompt !== undefined
              ? { systemPromptLength: clean.systemPrompt.length }
              : {}),
          },
        });
        res.json(userConfig.get(userId));
      },
    },
  ];
}
