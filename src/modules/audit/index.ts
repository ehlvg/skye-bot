import type { SkyeModule } from "../../core/module.js";
import { migrations } from "./migrations.js";
import { buildRoutes } from "./routes.js";
import { type AuditEntry, type AuditService, logRequest, scheduleAuditPruning } from "./service.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    audit: AuditService;
  }
}

export const auditModule: SkyeModule = {
  name: "audit",
  migrations,
  init(ctx) {
    const model = String(ctx.config.MODEL ?? "");
    const service: AuditService = {
      log(entry: AuditEntry) {
        logRequest(entry, model);
      },
    };
    ctx.services.set("audit", service);
    scheduleAuditPruning();
    return { service, panelRoutes: buildRoutes() };
  },
};
