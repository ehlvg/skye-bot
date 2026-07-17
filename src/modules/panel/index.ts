import express, { type Request, type Response, type NextFunction, type Express } from "express";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";
import type { SkyeModule } from "../../core/module.js";
import { panelConfigSchema } from "./config.js";
import { validateInitData, type ValidatedInitData } from "./auth.js";
import { tenantFromInitData, type TenantContext } from "../../core/tenant.js";
import { log } from "../../utils/log.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PanelRequest extends Request {
  tenant: TenantContext;
  initData: ValidatedInitData;
}

let server: import("http").Server | null = null;

export const panelModule: SkyeModule = {
  name: "panel",
  configSchema: panelConfigSchema,
  async start(ctx, contributions, extra) {
    const c = ctx.config;
    const botToken = c.bot_token;
    const webappPort = c.panel.webapp_port;

    const app: Express = extra.app ?? express();
    // Import accepts up to 1000 memories, each capped by the memory service.
    app.use(express.json({ limit: "3mb" }));

    const monitoring = ctx.services.get("monitoring");
    app.get(["/healthz", "/health/live"], (_req: Request, res: Response) => {
      res.json(monitoring.live());
    });
    app.get("/health/ready", (_req: Request, res: Response) => {
      const report = monitoring.ready();
      res.status(report.status === "ok" ? 200 : 503).json(report);
    });

    // Auth middleware — populates req.tenant from validated initData.
    app.use("/api", (req: Request, res: Response, next: NextFunction) => {
      const initData = req.headers["x-telegram-init-data"];
      if (typeof initData !== "string") {
        res.status(401).json({ error: "Missing init data" });
        return;
      }
      const validated = validateInitData(initData, botToken);
      if (!validated) {
        res.status(401).json({ error: "Invalid init data" });
        return;
      }
      (req as PanelRequest).initData = validated;
      (req as PanelRequest).tenant = tenantFromInitData(validated);
      next();
    });

    for (const route of contributions.panelRoutes) {
      const fullPath = route.path.startsWith("/api") ? route.path : `/api${route.path}`;
      app[route.method](fullPath, (req, res, next) => {
        Promise.resolve(route.handler(req as PanelRequest, res, next)).catch(next);
      });
    }

    // Serve the static React build from web/dist if present.
    const publicDir = join(__dirname, "..", "..", "..", "web", "dist");
    if (existsSync(publicDir)) {
      app.use(express.static(publicDir));
      app.get("/{*splat}", (_req: Request, res: Response) => {
        res.sendFile(join(publicDir, "index.html"));
      });
    }

    server = app.listen(webappPort, () => {
      log.info(`Panel server listening on port ${webappPort}`);
    });
  },
  async shutdown() {
    if (server) await new Promise<void>((r) => server!.close(() => r()));
  },
};
