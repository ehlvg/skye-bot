import { z } from "zod";
import { section } from "../../core/config.js";

export const mcpConfigSchema = z.object({
  mcp: section({
    config_path: z.string().default(""),
  }),
});

export type McpConfig = z.infer<typeof mcpConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    mcp: { config_path: string };
  }
}