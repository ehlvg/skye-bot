import { z } from "zod";
import { section } from "../../core/config.js";

export const legalConfigSchema = z.object({
  legal: section({
    terms_url: z.string().url().default("https://shiftlinehq.craft.me/skye-terms"),
    privacy_url: z.string().url().default("https://shiftlinehq.craft.me/skye-privacy"),
    source_url: z.string().url().default("https://github.com/ehlvg/skye-bot"),
    security_url: z.string().url().default("https://github.com/ehlvg/skye-bot/security/policy"),
    support_username: z.string().default("@overwaven"),
    developer_name: z.string().default("Sergey Gamuylo"),
    developer_alias: z.string().default("Erich Helvig"),
    developer_email: z.string().default("serg@skye-bot.com"),
  }),
});

export type LegalConfig = z.infer<typeof legalConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    legal: {
      terms_url: string;
      privacy_url: string;
      source_url: string;
      security_url: string;
      support_username: string;
      developer_name: string;
      developer_alias: string;
      developer_email: string;
    };
  }
}
