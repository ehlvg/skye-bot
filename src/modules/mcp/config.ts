import { z } from "zod";
import { section } from "../../core/config.js";

export const mcpConfigSchema = z.object({
  mcp: section({
    config_path: z.string().default(""),
    allow_private_user_servers: z.boolean().default(false),
    max_tool_output_chars: z.number().int().min(1_000).max(1_000_000).default(64_000),
  }),
});

export type McpConfig = z.infer<typeof mcpConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    mcp: {
      config_path: string;
      allow_private_user_servers: boolean;
      max_tool_output_chars: number;
    };
  }
}
