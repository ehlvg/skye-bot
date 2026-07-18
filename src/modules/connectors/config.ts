import { z } from "zod";
import { section } from "../../core/config.js";

const defaultToolkits = ["gmail", "googlecalendar", "googledrive", "github", "notion", "slack"];

export const connectorsConfigSchema = z.object({
  connectors: section({
    composio: z
      .object({
        api_key: z.string().default(""),
        allowed_toolkits: z
          .array(z.string().regex(/^[a-z0-9_]+$/))
          .min(1)
          .max(100)
          .default(defaultToolkits),
        disable_destructive_tools: z.boolean().default(true),
      })
      .default({
        api_key: "",
        allowed_toolkits: defaultToolkits,
        disable_destructive_tools: true,
      }),
    custom: z
      .object({
        enabled: z.boolean().default(true),
        max_per_user: z.number().int().min(0).max(50).default(8),
        allow_private_networks: z.boolean().default(false),
      })
      .default({
        enabled: true,
        max_per_user: 8,
        allow_private_networks: false,
      }),
    max_tool_output_chars: z.number().int().min(1_000).max(1_000_000).default(64_000),
  }),
});

export type ConnectorsConfig = z.infer<typeof connectorsConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    connectors: {
      composio: {
        api_key: string;
        allowed_toolkits: string[];
        disable_destructive_tools: boolean;
      };
      custom: {
        enabled: boolean;
        max_per_user: number;
        allow_private_networks: boolean;
      };
      max_tool_output_chars: number;
    };
  }
}
