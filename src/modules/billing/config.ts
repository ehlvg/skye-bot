import { z } from "zod";
import { section } from "../../core/config.js";

export interface TokenPack {
  id: string;
  name: string;
  stars: number;
  tokens: number;
}

const tokenPackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stars: z.number().int().positive(),
  tokens: z.number().int().positive(),
});

const defaultPacks: TokenPack[] = [
  { id: "pack_500", name: "Quick Boost", stars: 499, tokens: 500000 },
  { id: "pack_1500", name: "Big Boost", stars: 999, tokens: 1500000 },
  { id: "pack_5000", name: "Mega Boost", stars: 2499, tokens: 5000000 },
];

export const billingConfigSchema = z.object({
  billing: section({
    enabled: z.boolean().default(true),
    currency: z.string().default("XTR"),
    title: z.string().default("Skye Plus"),
    description: z
      .string()
      .default("Monthly subscription — unlocks Skye and adds 2,000,000 tokens per month."),
    subscription_stars: z.number().int().positive().default(1899),
    subscription_period_seconds: z.number().int().positive().default(2_592_000),
    base_quota_tokens: z.number().int().positive().default(2_000_000),
    token_packs: z.array(tokenPackSchema).default(defaultPacks),
  }),
});

export type BillingConfig = z.infer<typeof billingConfigSchema>;

declare module "../../core/config.js" {
  interface SkyeConfig {
    billing: {
      enabled: boolean;
      currency: string;
      title: string;
      description: string;
      subscription_stars: number;
      subscription_period_seconds: number;
      base_quota_tokens: number;
      token_packs: TokenPack[];
    };
  }
}
