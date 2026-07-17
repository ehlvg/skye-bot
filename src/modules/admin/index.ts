import type { SkyeModule } from "../../core/module.js";
import { adminConfigSchema, parseAdminIds } from "./config.js";
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
  configSchema: adminConfigSchema,
  migrations,
  init(ctx) {
    const c = ctx.config;
    const admin = new AdminService(parseAdminIds(c.admin_ids));
    ctx.services.set("admin", admin);

    // One-time seed of the allowlist from the legacy allowed_ids config value,
    // so existing SaaS/self-host operators don't lose access on upgrade.
    const legacy = c.allowed_ids;
    if (legacy.trim()) {
      const ids = parseAdminIds(legacy);
      if (ids.size > 0) admin.seedAllowlist([...ids]);
    }

    return { service: admin, commands: buildAdminCommands(admin) };
  },
};