import type { SkyeModule } from "../../core/module.js";
import { connectorsConfigSchema } from "./config.js";
import { ConnectorService } from "./service.js";
import { buildConnectorRoutes } from "./routes.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    connectors: ConnectorService;
  }
}

let serviceRef: ConnectorService | null = null;

export const connectorsModule: SkyeModule = {
  name: "connectors",
  configSchema: connectorsConfigSchema,
  async init(ctx) {
    const config = ctx.config.connectors;
    const service = new ConnectorService({
      userConfig: ctx.services.get("userConfig"),
      composioApiKey: config.composio.api_key,
      allowedToolkits: config.composio.allowed_toolkits,
      disableDestructiveTools: config.composio.disable_destructive_tools,
      customEnabled: config.custom.enabled,
      maxCustomPerUser: config.custom.max_per_user,
      allowPrivateCustomServers: config.custom.allow_private_networks,
      maxToolOutputChars: config.max_tool_output_chars,
    });
    serviceRef = service;
    await service.init();
    ctx.services.set("connectors", service);
    return {
      service,
      panelRoutes: buildConnectorRoutes(ctx, service),
    };
  },
  async shutdown() {
    await serviceRef?.shutdown();
    serviceRef = null;
  },
};
