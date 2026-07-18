import type { SkyeModule } from "../../core/module.js";
import { adminConfigSchema, parseAdminIds, parseAllowedIds } from "./config.js";
import { migrations } from "./migrations.js";
import { AdminService } from "./service.js";
import { buildAdminCommands } from "./tele.js";
import { buildAdminRoutes } from "./routes.js";
import { log } from "../../utils/log.js";

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
    if (c.access.mode === "subscription" && !c.billing.enabled) {
      throw new Error("access.mode=subscription requires billing.enabled=true");
    }
    if (c.access.mode === "open") {
      log.warn("Access mode is open: every Telegram user can spend the configured provider key");
    }
    const configuredAdminIds = parseAdminIds(c.admin_ids);
    const admin = new AdminService({
      ownerId: c.owner.user_id || undefined,
      configuredAdminIds,
    });
    ctx.services.set("admin", admin);

    const claimToken = admin.bootstrapTokenForLogs();
    if (claimToken) {
      log.warn(
        {
          command: `/claim_owner ${claimToken}`,
          hint: "Send this once in a private chat with the bot. The token is invalidated immediately after use.",
        },
        "No primary owner configured; waiting for secure first-run claim"
      );
    }

    // One-time seed of the allowlist from the legacy allowed_ids config value,
    // so existing SaaS/self-host operators don't lose access on upgrade.
    const legacy = c.allowed_ids;
    if (legacy.trim()) {
      const ids = parseAllowedIds(legacy);
      if (ids.size > 0) admin.seedAllowlist([...ids]);
    }

    return {
      service: admin,
      commands: buildAdminCommands(admin),
      panelRoutes: buildAdminRoutes(ctx),
    };
  },
};
