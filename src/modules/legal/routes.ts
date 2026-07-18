import type { ModuleContext, PanelRoute } from "../../core/module.js";
import { appCommit, appVersion } from "../../core/appInfo.js";
import type { PanelRequest } from "../panel/index.js";

export function buildAboutRoutes(ctx: ModuleContext): PanelRoute[] {
  return [
    {
      method: "get",
      path: "/about",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        const admin = ctx.services.get("admin");
        const commit = appCommit();
        res.json({
          name: "Skye",
          version: appVersion(),
          commit: commit ?? null,
          sourceUrl: commit
            ? `${ctx.config.legal.source_url}/tree/${commit}`
            : ctx.config.legal.source_url,
          securityUrl: ctx.config.legal.security_url,
          license: "AGPL-3.0-only",
          maintainer: {
            name: ctx.config.legal.developer_name,
            alias: ctx.config.legal.developer_alias,
            telegram: ctx.config.legal.support_username,
            email: ctx.config.legal.developer_email,
          },
          accessMode: ctx.config.access.mode,
          billingEnabled: ctx.config.billing.enabled,
          isAdmin: admin.isAdmin(panelReq.initData.user.id),
          isOwner: admin.isOwner(panelReq.initData.user.id),
        });
      },
    },
  ];
}
