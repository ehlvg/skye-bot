import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";

function ownerOnly(ctx: ModuleContext, req: PanelRequest): boolean {
  return ctx.services.get("admin").isOwner(req.initData.user.id);
}

export function buildAdminRoutes(ctx: ModuleContext): PanelRoute[] {
  const admin = ctx.services.get("admin");
  const audit = () => (ctx.services.has("audit") ? ctx.services.get("audit") : null);

  return [
    {
      method: "get",
      path: "/admin/principals",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!admin.isAdmin(panelReq.initData.user.id)) {
          res.status(403).json({ error: "Administrator access required" });
          return;
        }
        res.json({
          ownerUserId: admin.ownerUserId() ?? null,
          canManage: admin.isOwner(panelReq.initData.user.id),
          admins: admin.listAdmins(),
        });
      },
    },
    {
      method: "post",
      path: "/admin/principals",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!ownerOnly(ctx, panelReq)) {
          res.status(403).json({ error: "Primary owner access required" });
          return;
        }
        const body = req.body as { userId?: unknown } | undefined;
        const userId = Number(body?.userId);
        if (!Number.isSafeInteger(userId) || userId <= 0) {
          res.status(400).json({ error: "A valid Telegram user ID is required" });
          return;
        }
        if (!admin.addAdmin(userId, panelReq.initData.user.id)) {
          res.status(409).json({ error: "That user is already an administrator" });
          return;
        }
        audit()?.event({
          action: "admin_added",
          userId: panelReq.initData.user.id,
          details: { targetUserId: userId, source: "panel" },
        });
        res.status(201).json({ admins: admin.listAdmins() });
      },
    },
    {
      method: "delete",
      path: "/admin/principals/:userId",
      handler: (req, res) => {
        const panelReq = req as PanelRequest;
        if (!ownerOnly(ctx, panelReq)) {
          res.status(403).json({ error: "Primary owner access required" });
          return;
        }
        const userId = Number(req.params.userId);
        if (!Number.isSafeInteger(userId) || userId <= 0) {
          res.status(400).json({ error: "Invalid Telegram user ID" });
          return;
        }
        const result = admin.removeAdmin(userId);
        if (result === "protected") {
          res
            .status(409)
            .json({ error: "This administrator is protected by owner or config settings" });
          return;
        }
        if (result === "not_found") {
          res.status(404).json({ error: "Delegated administrator not found" });
          return;
        }
        audit()?.event({
          action: "admin_removed",
          userId: panelReq.initData.user.id,
          details: { targetUserId: userId, source: "panel" },
        });
        res.json({ admins: admin.listAdmins() });
      },
    },
  ];
}
