import { z } from "zod";

export interface TokenPack {
  id: string;
  name: string;
  stars: number;
  tokens: number;
}

const packsArray = z
  .string()
  .transform((raw, ctx): TokenPack[] => {
    try {
      const parsed = JSON.parse(raw);
      const arr = z
        .array(
          z.object({
            id: z.string().min(1),
            name: z.string().min(1),
            stars: z.coerce.number().int().positive(),
            tokens: z.coerce.number().int().positive(),
          })
        )
        .safeParse(parsed);
      if (!arr.success) {
        ctx.addIssue({ code: "custom", message: "invalid token packs array" });
        return z.NEVER;
      }
      return arr.data;
    } catch {
      ctx.addIssue({ code: "custom", message: "token packs must be a JSON array" });
      return z.NEVER;
    }
  });

const defaultPacks: TokenPack[] = [
  { id: "pack_500", name: "Quick Boost", stars: 499, tokens: 500000 },
  { id: "pack_1500", name: "Big Boost", stars: 999, tokens: 1500000 },
  { id: "pack_5000", name: "Mega Boost", stars: 2499, tokens: 5000000 },
];

export const billingEnvSchema = z.object({
  // Currency for Telegram Stars payments is always "XTR".
  BILLING_CURRENCY: z.string().default("XTR"),
  BILLING_TITLE: z.string().default("Skye Plus"),
  BILLING_DESCRIPTION: z
    .string()
    .default("Monthly subscription — unlocks Skye and adds 2,000,000 tokens per month."),
  BILLING_SUBSCRIPTION_STARS: z.coerce.number().int().positive().default(1899),
  BILLING_SUBSCRIPTION_PERIOD_SECONDS: z.coerce.number().int().positive().default(2_592_000),
  BILLING_BASE_QUOTA_TOKENS: z.coerce.number().int().positive().default(2_000_000),
  BILLING_TOKEN_PACKS: packsArray.default(defaultPacks),
});

export type BillingEnv = z.infer<typeof billingEnvSchema>;