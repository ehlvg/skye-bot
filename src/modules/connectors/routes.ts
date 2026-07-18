import type { ModuleContext, PanelRoute } from "../../core/module.js";
import type { PanelRequest } from "../panel/index.js";
import { log } from "../../utils/log.js";
import {
  assertSafeCustomConnectorUrl,
  parseCustomConnectorConfig,
  type ConnectorService,
} from "./service.js";

const MAX_NAME_CHARS = 80;
const MAX_INPUTS = 32;
const MAX_INPUT_CHARS = 16_000;

function pathParam(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? "") : value;
}

function cleanName(value: unknown): string {
  if (typeof value !== "string") throw new Error("Connector name is required");
  const name = value.trim();
  if (!name || name.length > MAX_NAME_CHARS) {
    throw new Error(`Connector name must be 1-${MAX_NAME_CHARS} characters`);
  }
  return name;
}

function cleanInputs(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Connector secrets must be an object");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_INPUTS) throw new Error("Too many connector secrets");
  return Object.fromEntries(
    entries.map(([key, input]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)) {
        throw new Error(`Invalid connector secret name: ${key}`);
      }
      if (typeof input !== "string" || input.length > MAX_INPUT_CHARS) {
        throw new Error(`Connector secret ${key} is too large`);
      }
      return [key, input];
    })
  );
}

function referencedInputIds(config: { headers?: Record<string, string> }): string[] {
  return Object.values(config.headers ?? {}).flatMap((value) => {
    const match = value.match(/^\$\{input:([A-Za-z_][A-Za-z0-9_]{0,63})\}$/);
    return match ? [match[1]] : [];
  });
}

function assertInputsAreReferenced(
  config: { headers?: Record<string, string> },
  inputs: Record<string, string>
): void {
  const referenced = new Set(referencedInputIds(config));
  for (const inputId of Object.keys(inputs)) {
    if (!referenced.has(inputId)) {
      throw new Error(`Connector secret ${inputId} is not referenced by a header`);
    }
  }
}

function customResponse(connectors: ConnectorService, userId: number) {
  return connectors.listCustomConnectors(userId).map((connector) => ({
    id: connector.id,
    name: connector.name,
    config: connector.config,
    connected: connectors.customToolCount(userId, connector.id) > 0,
    toolCount: connectors.customToolCount(userId, connector.id),
  }));
}

function managedResponse(catalog: Awaited<ReturnType<ConnectorService["managedCatalog"]>>) {
  return {
    enabled: catalog.enabled,
    connectors: catalog.connectors.map((connector) => ({
      slug: connector.slug,
      name: connector.name,
      ...(connector.logo ? { logo: connector.logo } : {}),
      connected: connector.connected,
      ...(connector.status ? { status: connector.status } : {}),
    })),
  };
}

export function buildConnectorRoutes(
  ctx: ModuleContext,
  connectors: ConnectorService
): PanelRoute[] {
  const userConfig = ctx.services.get("userConfig");
  const audit = () => (ctx.services.has("audit") ? ctx.services.get("audit") : null);

  return [
    {
      method: "get",
      path: "/connectors",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        try {
          const managed = await connectors.managedCatalog(userId);
          res.json({
            managed: managedResponse(managed),
            custom: customResponse(connectors, userId),
            customEnabled: connectors.customConnectorsEnabled(),
            maxCustom: connectors.maxCustomConnectors(),
          });
        } catch (error) {
          log.warn({ err: error, userId }, "Managed connector catalog unavailable");
          res.json({
            managed: { enabled: connectors.managedEnabled(), connectors: [] },
            custom: customResponse(connectors, userId),
            customEnabled: connectors.customConnectorsEnabled(),
            maxCustom: connectors.maxCustomConnectors(),
            managedUnavailable: true,
          });
        }
      },
    },
    {
      method: "post",
      path: "/connectors/managed/:toolkit/authorize",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const toolkit = pathParam(req.params.toolkit);
        try {
          const redirectUrl = await connectors.authorizeManaged(
            userId,
            toolkit,
            ctx.config.panel.webapp_url
          );
          audit()?.event({
            action: "connector_authorization_started",
            userId,
            details: { toolkit, provider: "composio" },
          });
          res.json({ redirectUrl });
        } catch (error) {
          res.status(400).json({
            error:
              error instanceof Error ? error.message : "Could not start connector authorization",
          });
        }
      },
    },
    {
      method: "delete",
      path: "/connectors/managed/:toolkit",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const toolkit = pathParam(req.params.toolkit);
        try {
          const disconnected = await connectors.disconnectManaged(userId, toolkit);
          if (!disconnected) {
            res.status(404).json({ error: "Connected account not found" });
            return;
          }
          audit()?.event({
            action: "connector_disconnected",
            userId,
            details: { toolkit, provider: "composio" },
          });
          res.json({ ok: true });
        } catch (error) {
          log.warn({ err: error, userId, toolkit }, "Disconnect failed");
          res.status(502).json({ error: "Could not disconnect that account" });
        }
      },
    },
    {
      method: "post",
      path: "/connectors/custom",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const body = (req.body ?? {}) as Record<string, unknown>;
        if (!connectors.customConnectorsEnabled()) {
          res.status(403).json({ error: "Custom connectors are disabled" });
          return;
        }
        if (body.acknowledgeRisk !== true) {
          res.status(400).json({ error: "You must acknowledge the custom connector warning" });
          return;
        }
        if (connectors.listCustomConnectors(userId).length >= connectors.maxCustomConnectors()) {
          res.status(409).json({ error: "Custom connector limit reached" });
          return;
        }
        let name: string;
        let config;
        let inputs: Record<string, string>;
        try {
          name = cleanName(body.name);
          config = parseCustomConnectorConfig(body.config);
          inputs = cleanInputs(body.inputs);
          assertInputsAreReferenced(config, inputs);
          await assertSafeCustomConnectorUrl(
            config.url,
            ctx.config.connectors.custom.allow_private_networks
          );
        } catch (error) {
          res.status(400).json({
            error: error instanceof Error ? error.message : "Invalid custom connector",
          });
          return;
        }
        const id = userConfig.addCustomConnector(userId, name, config);
        for (const [inputId, value] of Object.entries(inputs)) {
          if (value) userConfig.setConnectorInput(id, inputId, value);
        }
        try {
          await connectors.connectCustomConnector(
            userId,
            id,
            name,
            config,
            userConfig.getConnectorInputs(id)
          );
        } catch (error) {
          userConfig.deleteCustomConnector(id, userId);
          log.warn({ err: error, userId, connectorId: id }, "Custom connector failed to connect");
          res.status(502).json({ error: "Could not connect to that HTTPS endpoint" });
          return;
        }
        audit()?.event({
          action: "custom_connector_added",
          userId,
          details: { id, host: new URL(config.url).hostname },
        });
        res.status(201).json(customResponse(connectors, userId).find((item) => item.id === id));
      },
    },
    {
      method: "put",
      path: "/connectors/custom/:id",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const id = Number(req.params.id);
        const existing = userConfig.getCustomConnector(id, userId);
        if (!Number.isSafeInteger(id) || id <= 0 || !existing) {
          res.status(404).json({ error: "Custom connector not found" });
          return;
        }
        const body = (req.body ?? {}) as Record<string, unknown>;
        if (!connectors.customConnectorsEnabled()) {
          res.status(403).json({ error: "Custom connectors are disabled" });
          return;
        }
        if (body.acknowledgeRisk !== true) {
          res.status(400).json({ error: "You must acknowledge the custom connector warning" });
          return;
        }
        let name: string;
        let config;
        let inputs: Record<string, string>;
        try {
          name = cleanName(body.name ?? existing.name);
          config = parseCustomConnectorConfig(body.config ?? existing.config);
          inputs = cleanInputs(body.inputs);
          assertInputsAreReferenced(config, inputs);
          await assertSafeCustomConnectorUrl(
            config.url,
            ctx.config.connectors.custom.allow_private_networks
          );
        } catch (error) {
          res.status(400).json({
            error: error instanceof Error ? error.message : "Invalid custom connector",
          });
          return;
        }
        for (const [inputId, value] of Object.entries(inputs)) {
          if (value) userConfig.setConnectorInput(id, inputId, value);
        }
        userConfig.retainConnectorInputs(id, referencedInputIds(config));
        userConfig.updateCustomConnector(id, userId, name, config);
        try {
          await connectors.connectCustomConnector(
            userId,
            id,
            name,
            config,
            userConfig.getConnectorInputs(id)
          );
        } catch (error) {
          log.warn({ err: error, userId, connectorId: id }, "Custom connector reconnect failed");
          res.status(502).json({ error: "Saved, but the endpoint could not be reached" });
          return;
        }
        audit()?.event({
          action: "custom_connector_updated",
          userId,
          details: { id, host: new URL(config.url).hostname },
        });
        res.json(customResponse(connectors, userId).find((item) => item.id === id));
      },
    },
    {
      method: "delete",
      path: "/connectors/custom/:id",
      handler: async (req, res) => {
        const userId = (req as PanelRequest).tenant.userId!;
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id <= 0 || !userConfig.getCustomConnector(id, userId)) {
          res.status(404).json({ error: "Custom connector not found" });
          return;
        }
        await connectors.disconnectCustomConnector(userId, id);
        userConfig.deleteCustomConnector(id, userId);
        audit()?.event({ action: "custom_connector_deleted", userId, details: { id } });
        res.json({ ok: true });
      },
    },
  ];
}
