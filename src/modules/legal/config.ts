import { z } from "zod";
import { section } from "../../core/config.js";

export const legalConfigSchema = z.object({
  legal: section({
    terms_url: z.string().url().default("https://shiftlinehq.craft.me/skye-terms"),
    privacy_url: z.string().url().default("https://shiftlinehq.craft.me/skye-privacy"),
    support_username: z.string().default("@overwaven"),
    developer_name: z.string().default("Sergey Gamuylo"),
    developer_email: z.string().default("serg@skye-bot.com"),
  }),
});

export type LegalConfig = z.infer<typeof legalConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    legal: {
      terms_url: string;
      privacy_url: string;
      support_username: string;
      developer_name: string;
      developer_email: string;
    };
  }
}