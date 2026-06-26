import type { SkyeModule } from "../../core/module.js";
import { billingEnvSchema, type BillingEnv, type TokenPack } from "./env.js";
import { migrations } from "./migrations.js";
import { BillingService } from "./service.js";
import { buildBilling, type BillingDeps } from "./tele.js";
import { decodeInvoiceConfig } from "./invoices.js";
import { buildRoutes } from "./routes.js";

export interface BillingConfig {
  baseQuotaTokens: number;
  periodSeconds: number;
}

declare module "../../core/module.js" {
  interface SkyeServices {
    billing: BillingService;
  }
}

export const billingModule: SkyeModule = {
  name: "billing",
  envSchema: billingEnvSchema,
  migrations,
  init(ctx) {
    const cfg = ctx.config as BillingEnv;
    const llm = ctx.services.get("llm");
    const billingConfig: BillingConfig = {
      baseQuotaTokens: cfg.BILLING_BASE_QUOTA_TOKENS,
      periodSeconds: cfg.BILLING_SUBSCRIPTION_PERIOD_SECONDS,
    };
    const billing = new BillingService(billingConfig, llm.defaultModelId);
    ctx.services.set("billing", billing);

    const deps: BillingDeps = {
      billing,
      llm,
      cfg: decodeInvoiceConfig(ctx.config),
      packs: cfg.BILLING_TOKEN_PACKS as TokenPack[],
      webappUrl: String(ctx.config.WEBAPP_URL ?? ""),
    };
    const { commands, handlers } = buildBilling(deps);

    return {
      service: billing,
      commands,
      telegramHandlers: handlers,
      panelRoutes: buildRoutes(ctx),
    };
  },
};