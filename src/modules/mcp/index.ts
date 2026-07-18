import type { SkyeModule } from "../../core/module.js";
import { mcpConfigSchema } from "./config.js";
import { McpService } from "./service.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    mcp: McpService;
  }
}

let serviceRef: McpService | null = null;

export const mcpModule: SkyeModule = {
  name: "mcp",
  configSchema: mcpConfigSchema,
  async init(ctx) {
    const service = new McpService({
      configPath: ctx.config.mcp.config_path,
      userConfig: ctx.services.get("userConfig"),
      allowPrivateUserServers: ctx.config.mcp.allow_private_user_servers,
      maxToolOutputChars: ctx.config.mcp.max_tool_output_chars,
    });
    serviceRef = service;
    // Connect global + user MCP servers asynchronously, but await so the
    // telegram start() phase sees a populated tool catalogue.
    await service.init();
    return { service };
  },
  async shutdown() {
    if (serviceRef) await serviceRef.shutdown();
  },
};
