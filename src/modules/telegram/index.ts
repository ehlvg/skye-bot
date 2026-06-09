import { Bot } from "grammy";
import type { SkyeModule } from "../../core/module.js";
import { telegramEnvSchema, parseAllowedIds } from "./env.js";
import { installTelegram } from "./handlers.js";
import { log } from "../../utils/log.js";

let botRef: Bot | null = null;

declare module "../../core/module.js" {
  interface SkyeServices {
    telegramBot: Bot;
  }
}

export const telegramModule: SkyeModule = {
  name: "telegram",
  envSchema: telegramEnvSchema,
  async init(ctx) {
    const token = String(ctx.config.BOT_TOKEN);
    const bot = new Bot(token);
    botRef = bot;
    // Expose the bot in the registry so other modules (e.g. panel for menu
    // buttons) can access it during start().
    return { service: bot };
  },
  async start(ctx, contributions, extra) {
    const bot = botRef!;
    extra.bot = bot;

    // Pre-flight: probe model capability before serving requests.
    const llm = ctx.services.get("llm");
    await llm.checkCapabilities();

    installTelegram(
      bot,
      {
        llm,
        mcp: ctx.services.get("mcp"),
        memory: ctx.services.get("memory"),
        chatLog: ctx.services.get("chatLog"),
        chatConfig: ctx.services.get("chatConfig"),
        userConfig: ctx.services.get("userConfig"),
        speech: ctx.services.get("speech"),
        audit: ctx.services.get("audit"),
        workspace: ctx.services.get("workspace"),
        skills: ctx.services.get("skills"),
        botToken: String(ctx.config.BOT_TOKEN),
        allowedIds: parseAllowedIds(String(ctx.config.ALLOWED_IDS ?? "")),
        webappUrl: String(ctx.config.WEBAPP_URL),
        defaultBaseUrl: String(ctx.config.BASE_URL),
        defaultModel: String(ctx.config.MODEL),
      },
      contributions
    );

    void bot.api
      .setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: "Settings",
          web_app: { url: String(ctx.config.WEBAPP_URL) },
        },
      })
      .catch((e) => log.warn({ err: e }, "Failed to set menu button"));

    void bot.start({ drop_pending_updates: true });
    log.info("Skye is alive");
  },
  async shutdown() {
    if (botRef) {
      await botRef.stop().catch(() => {});
    }
  },
};
