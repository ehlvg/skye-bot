import { closeSync, fstatSync, openSync, readSync } from "fs";
import type { SkyeModule } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { monitoringEnvSchema } from "./env.js";

const MAX_BYTES = 256 * 1024;
const MAX_LINES = 250;

function tail(file?: string): string[] {
  if (!file) return [];

  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, MAX_BYTES);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, Math.max(0, size - length));
    return buffer
      .toString("utf8")
      .split("\n")
      .slice(size > MAX_BYTES ? 1 : 0)
      .filter(Boolean)
      .slice(-MAX_LINES);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export const monitoringModule: SkyeModule = {
  name: "monitoring",
  envSchema: monitoringEnvSchema,
  init(ctx) {
    const outLog = ctx.config.MONITORING_OUT_LOG?.toString();
    const errorLog = ctx.config.MONITORING_ERROR_LOG?.toString();
    const startedAt = new Date().toISOString();

    return {
      panelRoutes: [
        {
          method: "get",
          path: "/monitoring",
          handler: (req, res) => {
            const panelReq = req as PanelRequest;
            const admin = ctx.services.get("admin");
            if (!admin.isAdmin(panelReq.initData.user.id)) {
              res.status(403).json({ error: "Administrator access required" });
              return;
            }

            res.json({
              status: "ok",
              startedAt,
              uptimeSeconds: Math.floor(process.uptime()),
              logs: { out: tail(outLog), error: tail(errorLog) },
            });
          },
        },
      ],
    };
  },
};
