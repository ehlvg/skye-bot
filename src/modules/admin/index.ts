import type { SkyeModule } from "../../core/module.js";
import { adminEnvSchema, type AdminEnv, parseAdminIds } from "./env.js";
import { migrations } from "./migrations.js";
import { AdminService } from "./service.js";
import { buildAdminCommands } from "./tele.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    admin: AdminService;
  }
}

export const adminModule: SkyeModule = {
  name: "admin",
  envSchema: adminEnvSchema,
  migrations,
  init(ctx) {
    const cfg = ctx.config as AdminEnv;
    const admin = new AdminService(parseAdminIds(String(cfg.ADMIN_IDS ?? "")));
    ctx.services.set("admin", admin);

    // One-time seed of the allowlist from the legacy ALLOWED_IDS config value,
    // so existing SaaS/self-host operators don't lose access on upgrade.
    const legacy = String((ctx.config as { ALLOWED_IDS?: string }).ALLOWED_IDS ?? "");
    if (legacy.trim()) {
      const ids = parseAdminIds(legacy);
      if (ids.size > 0) admin.seedAllowlist([...ids]);
    }

    return { service: admin, commands: buildAdminCommands(admin) };
  },
};