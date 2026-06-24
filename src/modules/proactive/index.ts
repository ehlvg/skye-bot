import type { SkyeModule } from "../../core/module.js";
import { proactiveEnvSchema, type ProactiveEnv } from "./env.js";
import { ProactiveService, type ProactiveSettings } from "./service.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    proactive: ProactiveService;
  }
}

export const proactiveModule: SkyeModule = {
  name: "proactive",
  envSchema: proactiveEnvSchema,
  init(ctx) {
    const cfg = ctx.config as ProactiveEnv;
    const settings: ProactiveSettings = {
      enabled: cfg.PROACTIVE_ENABLED,
      probability: cfg.PROACTIVE_PROBABILITY,
      warmup: cfg.PROACTIVE_WARMUP,
      minIntervalSec: cfg.PROACTIVE_MIN_INTERVAL_SEC,
      contextSize: cfg.PROACTIVE_CONTEXT_SIZE,
    };
    const service = new ProactiveService(
      {
        llm: ctx.services.get("llm"),
        chatLog: ctx.services.get("chatLog"),
        memory: ctx.services.get("memory"),
      },
      settings
    );
    return { service };
  },
};