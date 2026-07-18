import type { SkyeModule } from "../../core/module.js";
import { legalConfigSchema } from "./config.js";
import { legalService, type LegalService } from "./service.js";
import { buildLegalCommands, buildLegalHandlers } from "./tele.js";
import { buildAboutRoutes } from "./routes.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    legal: LegalService;
  }
}

export const legalModule: SkyeModule = {
  name: "legal",
  configSchema: legalConfigSchema,
  init(ctx) {
    ctx.services.set("legal", legalService);

    const cfg = ctx.config.legal;
    const connectors = ctx.services.get("connectors");
    const { commands, handlers } = {
      commands: buildLegalCommands({ legal: legalService, cfg, connectors }),
      handlers: buildLegalHandlers({ legal: legalService, cfg, connectors }),
    };

    return {
      service: legalService,
      commands,
      telegramHandlers: handlers,
      panelRoutes: buildAboutRoutes(ctx),
    };
  },
};
