import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { UserConfig } from "./service.js";
import type { PanelRequest } from "../panel/index.js";
import { log } from "../../utils/log.js";
import { assertSafeUserMcpUrl, parseUserMcpConfig } from "../mcp/service.js";

const MAX_SYSTEM_PROMPT_CHARS = 16_000;
const MAX_MCP_NAME_CHARS = 80;
const MAX_MCP_INPUTS = 32;
const MAX_MCP_INPUT_CHARS = 16_000;

function cleanInputs(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP inputs must be an object");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_MCP_INPUTS) throw new Error("Too many MCP inputs");
  return Object.fromEntries(
    entries.map(([key, input]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) {
        throw new Error(`Invalid MCP input name: ${key}`);
      }
      if (typeof input !== "string" || input.length > MAX_MCP_INPUT_CHARS) {
        throw new Error(`MCP input ${key} is too large`);
      }
      return [key, input];
    })
  );
}

function cleanServerName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Server name is required");
  const name = value.trim();
  if (!name || name.length > MAX_MCP_NAME_CHARS) {
    throw new Error(`Server name must be 1-${MAX_MCP_NAME_CHARS} characters`);
  }
  return name;
}

export function buildRoutes(ctx: ModuleContext): PanelRoute[] {
  const userConfig = ctx.services.get("userConfig");
  const audit = () => (ctx.services.has("audit") ? ctx.services.get("audit") : null);
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
        const body = (req.body ?? {}) as Partial<UserConfig>;
        const clean: UserConfig = {};
        if (body.systemPrompt !== undefined) {
          if (
            typeof body.systemPrompt !== "string" ||
            body.systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS
          ) {
            res.status(400).json({
              error: `System prompt must be at most ${MAX_SYSTEM_PROMPT_CHARS} characters`,
            });
            return;
          }
          clean.systemPrompt = body.systemPrompt;
        }
        if (["skye", "skye.exe", "operator", "muse"].includes(body.personality ?? "")) {
          clean.personality = body.personality;
        }
        userConfig.set(userId, clean);
        audit()?.event({
          action: "settings_saved",
          userId,
          details: {
            changed: Object.keys(clean),
            ...(clean.personality ? { personality: clean.personality } : {}),
            ...(clean.systemPrompt !== undefined
              ? { systemPromptLength: clean.systemPrompt.length }
              : {}),
          },
        });
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
        const { name, config, inputs } = (req.body ?? {}) as {
          name?: string;
          config?: Record<string, unknown>;
          inputs?: Record<string, string>;
        };
        if (!name || !config) {
          res.status(400).json({ error: "Name and config are required" });
          return;
        }

        let parsed;
        let safeName: string;
        let safeInputs: Record<string, string>;
        try {
          safeName = cleanServerName(name);
          safeInputs = cleanInputs(inputs);
          parsed = parseUserMcpConfig(config);
          await assertSafeUserMcpUrl(parsed.url, ctx.config.mcp.allow_private_user_servers);
        } catch (error) {
          res
            .status(400)
            .json({ error: error instanceof Error ? error.message : "Invalid MCP server" });
          return;
        }
        const id = userConfig.addMcpServer(userId, safeName, parsed);

        for (const [inputId, value] of Object.entries(safeInputs)) {
          userConfig.setMcpInput(id, inputId, value);
        }

        if (mcp) {
          try {
            await mcp.connectUserServer(userId, id, safeName, parsed, userConfig.getMcpInputs(id));
          } catch (e) {
            log.error({ userId, server: name, err: e }, "Failed to connect user MCP server");
            userConfig.deleteMcpServer(id, userId);
            res.status(502).json({ error: "Failed to connect MCP server" });
            return;
          }
        }

        res.json({
          id,
          name: safeName,
          config: parsed,
          connected: true,
          toolCount: mcp?.userToolCount(userId, id) ?? 0,
        });
        audit()?.event({ action: "mcp_server_added", userId, details: { id, name: safeName } });
      },
    },
    {
      method: "put",
      path: "/mcp/:id",
      handler: async (req, res) => {
        const mcp = getMcp();
        const userId = (req as PanelRequest).tenant.userId!;
        const id = Number(req.params.id);
        const { name, config, inputs } = (req.body ?? {}) as {
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
        let safeName: string;
        let safeInputs: Record<string, string>;
        try {
          safeName = cleanServerName(name ?? existing.name);
          safeInputs = cleanInputs(inputs);
          parsed = parseUserMcpConfig(config ?? existing.config);
          await assertSafeUserMcpUrl(parsed.url, ctx.config.mcp.allow_private_user_servers);
        } catch (error) {
          res
            .status(400)
            .json({ error: error instanceof Error ? error.message : "Invalid MCP server" });
          return;
        }
        if (mcp) await mcp.disconnectUserServer(userId, id);
        userConfig.updateMcpServer(id, userId, safeName, parsed);

        for (const [inputId, value] of Object.entries(safeInputs)) {
          userConfig.setMcpInput(id, inputId, value);
        }

        if (mcp) {
          try {
            await mcp.connectUserServer(userId, id, safeName, parsed, userConfig.getMcpInputs(id));
          } catch (e) {
            log.error({ userId, server: name, err: e }, "Failed to reconnect user MCP server");
          }
        }

        res.json({
          id,
          name: safeName,
          config: parsed,
          connected: true,
          toolCount: mcp?.userToolCount(userId, id) ?? 0,
        });
        audit()?.event({ action: "mcp_server_updated", userId, details: { id, name: safeName } });
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

        const existing = userConfig.getMcpServer(id, userId);
        if (!existing) {
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
        audit()?.event({
          action: "mcp_server_deleted",
          userId,
          details: { id, name: existing.name },
        });
      },
    },
  ];
}
