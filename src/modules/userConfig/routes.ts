import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { UserConfig } from "./service.js";
import type { PanelRequest } from "../panel/index.js";
import { log } from "../../utils/log.js";
import { parseUserMcpConfig } from "../mcp/service.js";

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  const userConfig = ctx.services.get("userConfig");
  // mcp service is registered AFTER userConfig — resolve lazily at request time.
  const getMcp = () => (ctx.services.has("mcp") ? ctx.services.get("mcp") : null);

  return [
    {
      method: "get",
      path: "/config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        res.json(userConfig.get(userId));
      },
    },
    {
      method: "put",
      path: "/config",
      handler: (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const body = req.body as Partial<UserConfig>;
        const clean: UserConfig = {};
        if (body.systemPrompt !== undefined) clean.systemPrompt = body.systemPrompt;
        userConfig.set(userId, clean);
        res.json(userConfig.get(userId));
      },
    },
    {
      method: "get",
      path: "/mcp",
      handler: (req, res) => {
        const mcp = getMcp();
        const userId = (req as PanelRequest).tenant.userId!;
        const servers = userConfig.listMcpServers(userId);
        const result = servers.map((s) => ({
          id: s.id,
          name: s.name,
          config: s.config,
          connected: true,
          toolCount: mcp?.userToolCount(userId, s.id) ?? 0,
        }));
        res.json(result);
      },
    },
    {
      method: "post",
      path: "/mcp",
      handler: async (req, res) => {
        const mcp = getMcp();
        const userId = (req as PanelRequest).tenant.userId!;
        const { name, config, inputs } = req.body as {
          name?: string;
          config?: Record<string, unknown>;
          inputs?: Record<string, string>;
        };
        if (!name || !config) {
          res.status(400).json({ error: "Name and config are required" });
          return;
        }

        let parsed;
        try {
          parsed = parseUserMcpConfig(config);
        } catch {
          res.status(400).json({ error: "Only HTTPS remote MCP servers are supported" });
          return;
        }
        const id = userConfig.addMcpServer(userId, name, parsed);

        if (inputs && typeof inputs === "object") {
          for (const [inputId, value] of Object.entries(inputs)) {
            userConfig.setMcpInput(id, inputId, value);
          }
        }

        if (mcp) {
          try {
            await mcp.connectUserServer(userId, id, name, parsed, inputs ?? {});
          } catch (e) {
            log.error({ userId, server: name, err: e }, "Failed to connect user MCP server");
            userConfig.deleteMcpServer(id, userId);
            res.status(502).json({ error: "Failed to connect MCP server" });
            return;
          }
        }

        res.json({
          id,
          name,
          config: parsed,
          connected: true,
          toolCount: mcp?.userToolCount(userId, id) ?? 0,
        });
      },
    },
    {
      method: "put",
      path: "/mcp/:id",
      handler: async (req, res) => {
        const mcp = getMcp();
        const userId = (req as PanelRequest).tenant.userId!;
        const id = Number(req.params.id);
        const { name, config, inputs } = req.body as {
          name?: string;
          config?: Record<string, unknown>;
          inputs?: Record<string, string>;
        };

        const existing = userConfig.getMcpServer(id, userId);
        if (!existing) {
          res.status(404).json({ error: "Server not found" });
          return;
        }

        let parsed;
        try {
          parsed = parseUserMcpConfig(config ?? existing.config);
        } catch {
          res.status(400).json({ error: "Only HTTPS remote MCP servers are supported" });
          return;
        }
        if (mcp) await mcp.disconnectUserServer(userId, id);
        userConfig.updateMcpServer(id, userId, name ?? existing.name, parsed);

        if (inputs && typeof inputs === "object") {
          for (const [inputId, value] of Object.entries(inputs)) {
            userConfig.setMcpInput(id, inputId, value);
          }
        }

        if (mcp) {
          try {
            await mcp.connectUserServer(userId, id, name ?? existing.name, parsed, inputs ?? {});
          } catch (e) {
            log.error({ userId, server: name, err: e }, "Failed to reconnect user MCP server");
          }
        }

        res.json({
          id,
          name: name ?? existing.name,
          config: parsed,
          connected: true,
          toolCount: mcp?.userToolCount(userId, id) ?? 0,
        });
      },
    },
    {
      method: "delete",
      path: "/mcp/:id",
      handler: async (req, res) => {
        const mcp = getMcp();
        const userId = (req as PanelRequest).tenant.userId!;
        const id = Number(req.params.id);

        if (!Number.isSafeInteger(id) || id <= 0) {
          res.status(400).json({ error: "Invalid server ID" });
          return;
        }

        if (!userConfig.getMcpServer(id, userId)) {
          res.status(404).json({ error: "Server not found" });
          return;
        }

        if (mcp) await mcp.disconnectUserServer(userId, id);
        const deleted = userConfig.deleteMcpServer(id, userId);

        if (!deleted) {
          res.status(404).json({ error: "Server not found" });
          return;
        }
        res.json({ ok: true });
      },
    },
  ];
}
