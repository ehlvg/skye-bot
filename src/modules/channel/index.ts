import type { SkyeModule, TelegramHandler } from "../../core/module.js";
import { channelEnvSchema, type ChannelEnv, resolveChannelChatId } from "./env.js";
import { migrations } from "./migrations.js";
import { channelService, type ChannelService } from "./service.js";
import { channelTools } from "./tools.js";
import { log } from "../../utils/log.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    channel: ChannelService;
  }
}

export const channelModule: SkyeModule = {
  name: "channel",
  envSchema: channelEnvSchema,
  migrations,
  init(ctx) {
    ctx.services.set("channel", channelService);
    const cfg = ctx.config as ChannelEnv;

    if (cfg.CHANNEL_ENABLED && !cfg.CHANNEL_CHAT_ID.trim()) {
      log.warn(
        "Channel module is enabled but CHANNEL_CHAT_ID is empty — set it in config.yaml under channel.chat_id"
      );
    }

    const channelChatId = resolveChannelChatId(cfg.CHANNEL_CHAT_ID);

    const captureHandlers: TelegramHandler[] = cfg.CHANNEL_ENABLED
      ? [
          {
            on: ["channel_post", "edited_channel_post"],
            // Run before message handlers but after the access gate.
            order: 60,
            handler: (_ctx, _tenant, next) => {
              try {
                channelService.capture(_ctx);
              } catch (e) {
                log.warn({ err: e }, "Failed to capture channel post");
              }
              return next();
            },
          },
        ]
      : [];

    const tools = cfg.CHANNEL_ENABLED
      ? channelTools({
          service: channelService,
          admin: ctx.services.get("admin"),
          getBot: () =>
            ctx.services.has("telegramBot") ? ctx.services.get("telegramBot") : undefined,
          getChatId: () => channelChatId,
          adminOnly: cfg.CHANNEL_ADMIN_ONLY,
          enabled: cfg.CHANNEL_ENABLED,
        })
      : [];

    return {
      service: channelService,
      tools,
      telegramHandlers: captureHandlers,
    };
  },
};
