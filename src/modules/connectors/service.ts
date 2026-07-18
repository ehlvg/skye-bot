import { createHash } from "crypto";
import { lookup } from "dns/promises";
import { isIP, type LookupFunction } from "net";
import { Composio } from "@composio/core";
import { OpenAIResponsesProvider } from "@composio/openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Agent } from "undici";
import { z } from "zod";
import type { UserConfigService, UserCustomConnector } from "../userConfig/service.js";
import { log } from "../../utils/log.js";

const customConnectorSchema = z
  .object({
    type: z.literal("http"),
    url: z
      .string()
      .max(2_048)
      .url()
      .refine((value) => new URL(value).protocol === "https:", {
        message: "Custom connector URLs must use HTTPS",
      }),
    headers: z
      .record(
        z
          .string()
          .min(1)
          .max(128)
          .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
        z.string().regex(/^\$\{input:[A-Za-z_][A-Za-z0-9_]{0,63}\}$/, {
          message: "Header values must reference a stored connector secret",
        })
      )
      .refine((headers) => Object.keys(headers).length <= 32, {
        message: "Custom connectors support at most 32 secret headers",
      })
      .optional(),
  })
  .superRefine((config, ctx) => {
    const url = new URL(config.url);
    if (url.username || url.password) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Connector credentials must use secret headers, not the URL",
      });
    }
  })
  .strict();

export type CustomConnectorConfig = z.infer<typeof customConnectorSchema>;

export interface ConnectorTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ManagedConnector {
  slug: string;
  name: string;
  logo?: string;
  connected: boolean;
  connectedAccountId?: string;
  status?: string;
}

export interface ManagedConnectorCatalog {
  enabled: boolean;
  connectors: ManagedConnector[];
}

export interface ConnectorDetailedTool extends ConnectorTool {
  connectorName: string;
  scope: "managed" | "custom";
  originalName: string;
}

interface CustomToolMapping {
  client: Client;
  connectorId: number;
  connectorName: string;
  toolName: string;
}

interface ConnectedCustomConnector {
  client: Client;
  dispatcher: Agent;
  connectorId: number;
  userId: number;
}

interface ManagedSessionConfig {
  toolkits: string[];
  manageConnections: { enable: false };
  sandbox: { enable: false };
  multiAccount: { enable: false };
  preload: { tools: string[] };
  tags: { disable: Array<"destructiveHint"> };
}

interface ManagedSession {
  sessionId: string;
  tools(): Promise<
    Array<{
      type: "function";
      name: string;
      description?: string | null;
      parameters?: Record<string, unknown> | null;
    }>
  >;
  authorize(toolkit: string, options?: { callbackUrl?: string }): Promise<{ redirectUrl: string }>;
  toolkits(options?: { toolkits?: string[]; limit?: number; isConnected?: boolean }): Promise<{
    items: Array<{
      slug: string;
      name: string;
      logo?: string;
      connection?: {
        isActive: boolean;
        connectedAccount?: { id: string; status: string };
      };
    }>;
  }>;
  execute(
    toolSlug: string,
    args?: Record<string, unknown>,
    options?: unknown,
    requestOptions?: { signal?: AbortSignal }
  ): Promise<{ data?: unknown; error?: unknown; logId?: string }>;
  update(config: ManagedSessionConfig): Promise<void>;
  delete(): Promise<unknown>;
}

interface ConnectorServiceOptions {
  userConfig: UserConfigService;
  composioApiKey: string;
  allowedToolkits: string[];
  disableDestructiveTools: boolean;
  customEnabled: boolean;
  maxCustomPerUser: number;
  allowPrivateCustomServers: boolean;
  maxToolOutputChars: number;
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateNetworkAddress(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (isIP(normalized) === 4) return isPrivateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (/^fe[89ab]/.test(normalized)) return true;
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
  }
  return false;
}

export async function assertSafeCustomConnectorUrl(
  urlValue: string,
  allowPrivate = false
): Promise<void> {
  if (allowPrivate) return;
  const url = new URL(urlValue);
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new Error("Private-network custom connectors are disabled");
  }
  if (isIP(hostname)) {
    if (isPrivateNetworkAddress(hostname)) {
      throw new Error("Private-network custom connectors are disabled");
    }
    return;
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateNetworkAddress(address))) {
    throw new Error("Connector hostname resolves to a private or reserved network");
  }
}

export function parseCustomConnectorConfig(config: unknown): CustomConnectorConfig {
  return customConnectorSchema.parse(config);
}

function resolveInputs(value: string, inputs: Record<string, string>): string {
  return value.replace(/\$\{input:([^}]+)\}/g, (match, inputId: string) => {
    return Object.hasOwn(inputs, inputId) ? inputs[inputId] : match;
  });
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((item: unknown) => {
      if (!item || typeof item !== "object") return String(item);
      const block = item as Record<string, unknown>;
      if (block.type === "text") return String(block.text ?? "");
      if (block.type === "resource") {
        const resource = block.resource as Record<string, unknown> | undefined;
        if (resource?.text) return String(resource.text);
        if (resource?.blob) return `[binary resource ${String(resource.mimeType ?? "")}]`;
      }
      if (block.type === "image") return `[image ${String(block.mimeType ?? "")}]`;
      return JSON.stringify(block);
    })
    .filter(Boolean)
    .join("\n");
}

function safeToolName(prefix: string, original: string): string {
  const clean = original.replace(/[^A-Za-z0-9_-]/g, "_");
  const base = `${prefix}_${clean}`;
  if (base.length <= 64) return base;
  const digest = createHash("sha256").update(base).digest("hex").slice(0, 8);
  return `${base.slice(0, 55)}_${digest}`;
}

function stringifyResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function connectorDispatcher(allowPrivate: boolean): Agent {
  const safeLookup: LookupFunction = (hostname, options, callback) => {
    lookup(hostname, {
      all: true,
      verbatim: true,
      ...(options.family ? { family: options.family } : {}),
      ...(options.hints ? { hints: options.hints } : {}),
    }).then(
      (addresses) => {
        if (
          addresses.length === 0 ||
          (!allowPrivate && addresses.some(({ address }) => isPrivateNetworkAddress(address)))
        ) {
          callback(new Error("Connector DNS resolved to a private or reserved network"), "", 0);
          return;
        }
        if (options.all) callback(null, addresses);
        else callback(null, addresses[0].address, addresses[0].family);
      },
      (error: NodeJS.ErrnoException) => callback(error, "", 0)
    );
  };
  return new Agent({ connect: { lookup: safeLookup } });
}

function connectorFetch(dispatcher: Agent) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const timeout = AbortSignal.timeout(20_000);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    const response = await globalThis.fetch(input, {
      ...init,
      redirect: "error",
      signal,
      dispatcher,
    } as RequestInit & { dispatcher: Agent });
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 8_000_000) {
      await response.body?.cancel();
      throw new Error("Connector response is too large");
    }
    return response;
  };
}

export class ConnectorService {
  private readonly userConfig: UserConfigService;
  private readonly allowedToolkits: string[];
  private readonly allowedToolkitSet: Set<string>;
  private readonly disableDestructiveTools: boolean;
  private readonly customEnabled: boolean;
  private readonly maxCustomPerUser: number;
  private readonly allowPrivateCustomServers: boolean;
  private readonly maxToolOutputChars: number;
  private readonly composio?: Composio<OpenAIResponsesProvider>;
  private readonly managedSessions = new Map<number, ManagedSession>();
  private readonly managedTools = new Map<number, ConnectorTool[]>();
  private readonly managedToolNames = new Map<number, Map<string, string>>();
  private readonly customTools = new Map<number, ConnectorTool[]>();
  private readonly customToolMaps = new Map<number, Map<string, CustomToolMapping>>();
  private readonly customConnections = new Map<number, ConnectedCustomConnector[]>();

  constructor(options: ConnectorServiceOptions) {
    this.userConfig = options.userConfig;
    this.allowedToolkits = [...new Set(options.allowedToolkits.map((slug) => slug.toLowerCase()))];
    this.allowedToolkitSet = new Set(this.allowedToolkits);
    this.disableDestructiveTools = options.disableDestructiveTools;
    this.customEnabled = options.customEnabled;
    this.maxCustomPerUser = options.maxCustomPerUser;
    this.allowPrivateCustomServers = options.allowPrivateCustomServers;
    this.maxToolOutputChars = options.maxToolOutputChars;
    if (options.composioApiKey) {
      this.composio = new Composio({
        apiKey: options.composioApiKey,
        provider: new OpenAIResponsesProvider(),
        allowTracking: false,
      });
    }
  }

  async init(): Promise<void> {
    if (!this.customEnabled) return;
    for (const connector of this.userConfig.listAllCustomConnectors()) {
      const parsed = customConnectorSchema.safeParse(connector.config);
      if (!parsed.success) {
        log.warn(
          { connectorId: connector.id, userId: connector.userId },
          "Skipping legacy non-HTTPS connector"
        );
        continue;
      }
      await this.connectCustomConnector(
        connector.userId,
        connector.id,
        connector.name,
        parsed.data,
        this.userConfig.getConnectorInputs(connector.id)
      ).catch((error) => {
        log.warn(
          { err: error, connectorId: connector.id, userId: connector.userId },
          "Custom connector unavailable during startup"
        );
      });
    }
  }

  managedEnabled(): boolean {
    return Boolean(this.composio);
  }

  customConnectorsEnabled(): boolean {
    return this.customEnabled;
  }

  maxCustomConnectors(): number {
    return this.maxCustomPerUser;
  }

  private composioUserId(userId: number): string {
    return `skye:telegram:${userId}`;
  }

  private async createManagedSession(userId: number): Promise<ManagedSession> {
    if (!this.composio) throw new Error("Managed connectors are not configured");
    const config = this.managedSessionConfig();
    const session = (await this.composio.sessions.create(
      this.composioUserId(userId),
      config
    )) as unknown as ManagedSession;
    this.userConfig.setConnectorSession(userId, "composio", session.sessionId);
    return session;
  }

  private managedSessionConfig(): ManagedSessionConfig {
    return {
      toolkits: this.allowedToolkits,
      manageConnections: { enable: false },
      sandbox: { enable: false },
      multiAccount: { enable: false },
      preload: { tools: [] as string[] },
      tags: {
        disable: this.disableDestructiveTools ? ["destructiveHint"] : [],
      },
    };
  }

  private async getManagedSession(userId: number): Promise<ManagedSession> {
    const cached = this.managedSessions.get(userId);
    if (cached) return cached;
    if (!this.composio) throw new Error("Managed connectors are not configured");
    const sessionId = this.userConfig.getConnectorSession(userId, "composio");
    let session: ManagedSession;
    if (sessionId) {
      try {
        session = (await this.composio.sessions.use(sessionId)) as unknown as ManagedSession;
        await session.update(this.managedSessionConfig());
      } catch (error) {
        log.warn({ err: error, userId, sessionId }, "Recreating unavailable Composio session");
        this.userConfig.deleteConnectorSession(userId, "composio");
        session = await this.createManagedSession(userId);
      }
    } else {
      session = await this.createManagedSession(userId);
    }
    this.managedSessions.set(userId, session);
    return session;
  }

  private invalidateManagedTools(userId: number): void {
    this.managedTools.delete(userId);
    this.managedToolNames.delete(userId);
  }

  private async managedToolsFor(userId: number): Promise<ConnectorTool[]> {
    if (!this.composio) return [];
    const cached = this.managedTools.get(userId);
    if (cached) return cached;
    if (
      !this.managedSessions.has(userId) &&
      !this.userConfig.getConnectorSession(userId, "composio")
    ) {
      return [];
    }
    const session = await this.getManagedSession(userId);
    const rawTools = await session.tools();
    const names = new Map<string, string>();
    const tools = rawTools.map((tool) => {
      const publicName = safeToolName("composio", tool.name);
      names.set(publicName, tool.name);
      return {
        type: "function" as const,
        name: publicName,
        description: tool.description ?? "Use a connected app through Composio.",
        parameters: tool.parameters ?? { type: "object", properties: {} },
      };
    });
    this.managedToolNames.set(userId, names);
    this.managedTools.set(userId, tools);
    return tools;
  }

  async toolsFor(userId?: number): Promise<ConnectorTool[]> {
    if (!userId) return [];
    const managed = await this.managedToolsFor(userId).catch((error) => {
      log.warn({ err: error, userId }, "Managed connector tools unavailable");
      return [];
    });
    return [...managed, ...(this.customTools.get(userId) ?? [])];
  }

  async detailedToolsFor(userId?: number): Promise<ConnectorDetailedTool[]> {
    if (!userId) return [];
    const tools = await this.toolsFor(userId);
    const managedNames = this.managedToolNames.get(userId);
    const customMap = this.customToolMaps.get(userId);
    return tools.map((tool) => {
      const managedName = managedNames?.get(tool.name);
      if (managedName) {
        return {
          ...tool,
          connectorName: "Composio",
          scope: "managed" as const,
          originalName: managedName,
        };
      }
      const custom = customMap?.get(tool.name);
      return {
        ...tool,
        connectorName: custom?.connectorName ?? "Custom",
        scope: "custom" as const,
        originalName: custom?.toolName ?? tool.name,
      };
    });
  }

  isConnectorTool(toolName: string, userId?: number): boolean {
    if (!userId) return false;
    return (
      this.managedToolNames.get(userId)?.has(toolName) === true ||
      this.customToolMaps.get(userId)?.has(toolName) === true
    );
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    userId?: number,
    signal?: AbortSignal
  ): Promise<string> {
    if (!userId) return "Unknown connector tool";
    const managedName = this.managedToolNames.get(userId)?.get(toolName);
    if (managedName) {
      const session = await this.getManagedSession(userId);
      const result = await session.execute(managedName, args, undefined, { signal });
      if (result.error)
        return this.limitOutput(`Connector error: ${stringifyResult(result.error)}`);
      return this.limitOutput(stringifyResult(result.data));
    }

    const mapping = this.customToolMaps.get(userId)?.get(toolName);
    if (!mapping) return `Unknown connector tool: ${toolName}`;
    try {
      const result = await mapping.client.callTool(
        { name: mapping.toolName, arguments: args },
        undefined,
        { signal }
      );
      if (result.isError)
        return this.limitOutput(`Connector error: ${extractText(result.content)}`);
      return this.limitOutput(extractText(result.content));
    } catch (error) {
      return `Connector error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async managedCatalog(userId: number): Promise<ManagedConnectorCatalog> {
    if (!this.composio) return { enabled: false, connectors: [] };
    const session = await this.getManagedSession(userId);
    const result = await session.toolkits({ toolkits: this.allowedToolkits, limit: 100 });
    const bySlug = new Map(result.items.map((item) => [item.slug.toLowerCase(), item]));
    const connectors = this.allowedToolkits.map((slug) => {
      const item = bySlug.get(slug);
      const account = item?.connection?.connectedAccount;
      return {
        slug,
        name: item?.name ?? slug.replace(/(^|[-_])(\w)/g, (_m, _p, c: string) => c.toUpperCase()),
        ...(item?.logo ? { logo: item.logo } : {}),
        connected: item?.connection?.isActive ?? false,
        ...(account?.id ? { connectedAccountId: account.id } : {}),
        ...(account?.status ? { status: account.status } : {}),
      };
    });
    return { enabled: true, connectors };
  }

  async authorizeManaged(userId: number, toolkit: string, callbackUrl: string): Promise<string> {
    const slug = toolkit.toLowerCase();
    if (!this.allowedToolkitSet.has(slug))
      throw new Error("Connector is not enabled by the operator");
    const session = await this.getManagedSession(userId);
    const request = await session.authorize(slug, { callbackUrl });
    const redirectUrl = new URL(request.redirectUrl);
    if (redirectUrl.protocol !== "https:") {
      throw new Error("Connector authorization returned an unsafe redirect");
    }
    this.invalidateManagedTools(userId);
    return redirectUrl.toString();
  }

  async disconnectManaged(userId: number, toolkit: string): Promise<boolean> {
    if (!this.composio) return false;
    const slug = toolkit.toLowerCase();
    if (!this.allowedToolkitSet.has(slug)) return false;
    const catalog = await this.managedCatalog(userId);
    const connector = catalog.connectors.find((item) => item.slug === slug);
    if (!connector?.connectedAccountId) return false;
    await this.composio.connectedAccounts.delete(connector.connectedAccountId);
    this.invalidateManagedTools(userId);
    return true;
  }

  listCustomConnectors(userId: number): UserCustomConnector[] {
    return this.userConfig.listCustomConnectors(userId).filter((connector) => {
      return customConnectorSchema.safeParse(connector.config).success;
    });
  }

  customToolCount(userId: number, connectorId: number): number {
    let count = 0;
    for (const mapping of this.customToolMaps.get(userId)?.values() ?? []) {
      if (mapping.connectorId === connectorId) count += 1;
    }
    return count;
  }

  async connectCustomConnector(
    userId: number,
    connectorId: number,
    name: string,
    config: CustomConnectorConfig,
    inputs: Record<string, string>
  ): Promise<void> {
    if (!this.customEnabled) throw new Error("Custom connectors are disabled");
    await assertSafeCustomConnectorUrl(config.url, this.allowPrivateCustomServers);
    await this.disconnectCustomConnector(userId, connectorId);
    const headers = Object.fromEntries(
      Object.entries(config.headers ?? {}).map(([key, value]) => [
        key,
        resolveInputs(value, inputs),
      ])
    );
    const client = new Client(
      { name: `skye-connector-${connectorId}`, version: "1.0.0" },
      { capabilities: {} }
    );
    const dispatcher = connectorDispatcher(this.allowPrivateCustomServers);
    const transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers },
      fetch: connectorFetch(dispatcher),
    });
    let listed;
    try {
      await client.connect(transport);
      listed = await client.listTools();
    } catch (error) {
      await client.close().catch(() => {});
      await dispatcher.close().catch(() => {});
      throw error;
    }
    const userMap = this.customToolMaps.get(userId) ?? new Map<string, CustomToolMapping>();
    const existingTools = (this.customTools.get(userId) ?? []).filter(
      (tool) => userMap.get(tool.name)?.connectorId !== connectorId
    );
    for (const [toolName, mapping] of userMap) {
      if (mapping.connectorId === connectorId) userMap.delete(toolName);
    }
    const tools = (listed.tools ?? []).slice(0, 100).map((tool) => {
      const publicName = safeToolName(`connector_${connectorId}`, tool.name);
      userMap.set(publicName, { client, connectorId, connectorName: name, toolName: tool.name });
      return {
        type: "function" as const,
        name: publicName,
        description: `[${name}] ${tool.description ?? "Custom connector tool"}`,
        parameters: (tool.inputSchema as Record<string, unknown>) ?? {
          type: "object",
          properties: {},
        },
      };
    });
    this.customToolMaps.set(userId, userMap);
    this.customTools.set(userId, [...existingTools, ...tools]);
    const connections = this.customConnections.get(userId) ?? [];
    connections.push({ client, dispatcher, connectorId, userId });
    this.customConnections.set(userId, connections);
  }

  async disconnectCustomConnector(userId: number, connectorId: number): Promise<void> {
    const connections = this.customConnections.get(userId) ?? [];
    const closing = connections.filter((entry) => entry.connectorId === connectorId);
    await Promise.all(
      closing.map(async (entry) => {
        await entry.client.close().catch(() => {});
        await entry.dispatcher.close().catch(() => {});
      })
    );
    this.customConnections.set(
      userId,
      connections.filter((entry) => entry.connectorId !== connectorId)
    );
    const map = this.customToolMaps.get(userId);
    const removedToolNames = new Set<string>();
    if (map) {
      for (const [toolName, mapping] of map) {
        if (mapping.connectorId === connectorId) {
          removedToolNames.add(toolName);
          map.delete(toolName);
        }
      }
    }
    this.customTools.set(
      userId,
      (this.customTools.get(userId) ?? []).filter((tool) => !removedToolNames.has(tool.name))
    );
  }

  async deleteExternalUserData(userId: number): Promise<void> {
    if (!this.composio) return;
    const sessionId = this.userConfig.getConnectorSession(userId, "composio");
    if (!sessionId) return;
    try {
      const session = await this.getManagedSession(userId);
      const connected = await session.toolkits({ isConnected: true, limit: 100 });
      let accountDeletionFailed = false;
      for (const toolkit of connected.items) {
        const accountId = toolkit.connection?.connectedAccount?.id;
        if (accountId) {
          await this.composio.connectedAccounts.delete(accountId).catch(() => {
            accountDeletionFailed = true;
          });
        }
      }
      await session.delete();
      if (accountDeletionFailed) {
        throw new Error("One or more managed connector accounts could not be deleted");
      }
    } finally {
      this.managedSessions.delete(userId);
      this.invalidateManagedTools(userId);
      this.userConfig.deleteConnectorSession(userId, "composio");
    }
  }

  private limitOutput(value: string): string {
    if (value.length <= this.maxToolOutputChars) return value;
    return `${value.slice(0, this.maxToolOutputChars)}\n\n[connector output truncated]`;
  }

  async shutdown(): Promise<void> {
    const connections = [...this.customConnections.values()].flat();
    await Promise.all(
      connections.map(async (entry) => {
        await entry.client.close().catch(() => {});
        await entry.dispatcher.close().catch(() => {});
      })
    );
    this.customConnections.clear();
    this.customToolMaps.clear();
    this.customTools.clear();
    this.managedSessions.clear();
    this.managedTools.clear();
    this.managedToolNames.clear();
  }
}
