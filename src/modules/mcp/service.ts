import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { log } from "../../utils/log.js";
import type { UserConfigService } from "../userConfig/service.js";
import { z } from "zod";

interface McpInput {
  id: string;
  description?: string;
  password?: boolean;
}

interface McpServerConfig {
  type?: "stdio" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

const userMcpConfigSchema = z
  .object({
    type: z.literal("http"),
    url: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === "https:", {
        message: "User MCP URLs must use HTTPS",
      }),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export type UserMcpServerConfig = z.infer<typeof userMcpConfigSchema>;

export function parseUserMcpConfig(config: unknown): UserMcpServerConfig {
  return userMcpConfigSchema.parse(config);
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
  inputs?: McpInput[];
}

interface McpToolMapping {
  serverName: string;
  client: Client;
  toolName: string;
  scope: "global" | "user";
  userId?: number;
  serverId?: number;
}

interface McpConnectedServer {
  name: string;
  client: Client;
  scope: "global" | "user";
  userId?: number;
  serverId?: number;
}

interface OpenAITool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface McpDetailedTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  serverName: string;
  scope: "global" | "user";
  toolName: string;
}

function userKey(userId: number, serverId: number): string {
  return `${userId}:${serverId}`;
}

function resolveVars(
  value: string,
  extraVars?: Record<string, string>,
  allowProcessEnv = true
): string {
  return value.replace(/\$\{(\w+)\}|\$\{input:([^}]+)\}/g, (_, envName, inputId) => {
    if (extraVars && inputId && extraVars[inputId]) return extraVars[inputId];
    if (!allowProcessEnv) return inputId ? `\${input:${inputId}}` : `\${${envName}}`;
    if (envName) return process.env[envName] ?? "";
    return process.env[inputId] ?? "";
  });
}

function resolveConfig(
  config: McpServerConfig,
  extraVars?: Record<string, string>,
  allowProcessEnv = true
): McpServerConfig {
  return {
    type: config.type,
    command: config.command ? resolveVars(config.command, extraVars, allowProcessEnv) : undefined,
    args: config.args?.map((a) => resolveVars(a, extraVars, allowProcessEnv)),
    cwd: config.cwd ? resolveVars(config.cwd, extraVars, allowProcessEnv) : undefined,
    env: config.env
      ? Object.fromEntries(
          Object.entries(config.env).map(([k, v]) => [
            k,
            resolveVars(v, extraVars, allowProcessEnv),
          ])
        )
      : undefined,
    url: config.url ? resolveVars(config.url, extraVars, allowProcessEnv) : undefined,
    headers: config.headers
      ? Object.fromEntries(
          Object.entries(config.headers).map(([k, v]) => [
            k,
            resolveVars(v, extraVars, allowProcessEnv),
          ])
        )
      : undefined,
  };
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);

  return content
    .map((item: unknown) => {
      if (typeof item !== "object" || item === null) return String(item);
      const c = item as Record<string, unknown>;
      if (c.type === "text") return String(c.text ?? "");
      if (c.type === "resource") {
        const res = c.resource as Record<string, unknown> | undefined;
        if (res?.text) return String(res.text);
        if (res?.blob) return `[binary blob ${res.mimeType ?? ""}]`;
        return JSON.stringify(c);
      }
      if (c.type === "image") return `[image ${c.mimeType ?? ""}]`;
      return JSON.stringify(c);
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Manages stdio/http MCP server connections in two scopes — global (loaded
 * from mcp.json on startup) and per-user (from userConfig). Exposes the merged
 * tool catalogue as OpenAI-compatible tool definitions.
 */
export class McpService {
  private globalToolMap = new Map<string, McpToolMapping>();
  private globalTools: OpenAITool[] = [];
  private globalConnectedServers: McpConnectedServer[] = [];
  private initialized = false;

  private userToolMaps = new Map<string, Map<string, McpToolMapping>>();
  private userToolsMap = new Map<string, OpenAITool[]>();
  private userConnectedServers = new Map<string, McpConnectedServer[]>();
  private userToolCounts = new Map<string, number>();

  private configPath: string;
  private userConfig: UserConfigService;

  constructor(opts: { configPath: string; userConfig: UserConfigService }) {
    this.configPath = opts.configPath || join(process.cwd(), "mcp.json");
    this.userConfig = opts.userConfig;
  }

  private loadConfig(): McpConfig | null {
    if (!existsSync(this.configPath)) return null;
    try {
      const raw = readFileSync(this.configPath, "utf-8");
      return JSON.parse(raw);
    } catch (e) {
      log.error({ err: e }, "Failed to parse mcp.json");
      return null;
    }
  }

  private getOrCreateUserToolMap(userId: number, serverId: number): Map<string, McpToolMapping> {
    const key = userKey(userId, serverId);
    if (!this.userToolMaps.has(key)) this.userToolMaps.set(key, new Map());
    return this.userToolMaps.get(key)!;
  }

  private async connectServer(
    name: string,
    rawCfg: McpServerConfig,
    scope: "global" | "user",
    extraVars?: Record<string, string>,
    userId?: number,
    serverId?: number
  ): Promise<{ client: Client; tools: OpenAITool[] } | null> {
    try {
      if (scope === "user") parseUserMcpConfig(rawCfg);
      const cfg = resolveConfig(rawCfg, extraVars, scope === "global");
      const client = new Client({ name: `skye-${name}`, version: "1.0.0" }, { capabilities: {} });

      const transportType = cfg.type ?? (cfg.url ? "http" : "stdio");

      if (transportType === "http") {
        if (!cfg.url) {
          log.warn({ server: name }, "HTTP MCP server missing url, skipping");
          return null;
        }
        const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
          requestInit: { headers: cfg.headers ?? {} },
        });
        await client.connect(transport);
      } else {
        if (!cfg.command) {
          log.warn({ server: name }, "Stdio MCP server missing command, skipping");
          return null;
        }
        const transport = new StdioClientTransport({
          command: cfg.command,
          args: cfg.args,
          env: { ...process.env, ...cfg.env } as Record<string, string>,
          cwd: cfg.cwd,
          stderr: "inherit",
        });
        await client.connect(transport);
      }

      const result = await client.listTools();
      const tools = result.tools ?? [];
      const openaiTools: OpenAITool[] = [];
      const toolMap =
        scope === "global" ? this.globalToolMap : this.getOrCreateUserToolMap(userId!, serverId!);

      for (const tool of tools) {
        if (scope === "global" && this.globalToolMap.has(tool.name)) {
          log.warn({ tool: tool.name, server: name }, "Tool name collision, skipping");
          continue;
        }
        const openaiTool: OpenAITool = {
          type: "function",
          name: scope === "global" ? tool.name : `u${userId}_${serverId}_${tool.name}`,
          description: tool.description ?? "",
          parameters: (tool.inputSchema as Record<string, unknown>) ?? {
            type: "object",
            properties: {},
          },
        };
        openaiTools.push(openaiTool);
        toolMap.set(openaiTool.name, {
          serverName: name,
          client,
          toolName: tool.name,
          scope,
          userId,
          serverId,
        });
      }

      const entry: McpConnectedServer = { name, client, scope, userId, serverId };

      if (scope === "global") {
        this.globalTools.push(...openaiTools);
        this.globalConnectedServers.push(entry);
      } else {
        const key = userKey(userId!, serverId!);
        this.userToolsMap.set(key, openaiTools);
        if (!this.userConnectedServers.has(key)) this.userConnectedServers.set(key, []);
        this.userConnectedServers.get(key)!.push(entry);
        this.userToolCounts.set(key, openaiTools.length);
      }

      log.info({ server: name, tools: tools.length, scope }, `MCP server connected`);
      return { client, tools: openaiTools };
    } catch (e) {
      log.error({ server: name, err: e }, `Failed to connect to MCP server "${name}"`);
      return null;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const config = this.loadConfig();
    if (config?.mcpServers && Object.keys(config.mcpServers).length > 0) {
      const entries = Object.entries(config.mcpServers);
      log.info(`Connecting to ${entries.length} global MCP server(s)...`);
      for (const [name, rawCfg] of entries) {
        await this.connectServer(name, rawCfg, "global");
      }
      if (this.globalTools.length > 0) {
        log.info(
          `Global MCP initialized — ${this.globalTools.length} tools from ${this.globalConnectedServers.length} server(s)`
        );
      }
    } else {
      log.info("No mcp.json found or empty — global MCP tools disabled");
    }

    const userServers = this.userConfig.listAllMcpServers();
    if (userServers.length > 0) {
      log.info(`Connecting to ${userServers.length} user MCP server(s)...`);
      for (const server of userServers) {
        const inputs = this.userConfig.getMcpInputs(server.id);
        const parsed = userMcpConfigSchema.safeParse(server.config);
        if (!parsed.success) {
          log.warn(
            { server: server.name, userId: server.userId },
            "Skipping unsafe user MCP config"
          );
          continue;
        }
        await this.connectServer(
          server.name,
          parsed.data,
          "user",
          inputs,
          server.userId,
          server.id
        );
      }
    }
  }

  toolsFor(userId?: number): OpenAITool[] {
    const tools: OpenAITool[] = [...this.globalTools];
    if (userId != null) {
      for (const [key, userTools] of this.userToolsMap) {
        if (key.startsWith(`${userId}:`)) {
          tools.push(...userTools);
        }
      }
    }
    return tools;
  }

  detailedToolsFor(userId?: number): McpDetailedTool[] {
    const result: McpDetailedTool[] = [];

    for (const tool of this.globalTools) {
      const mapping = this.globalToolMap.get(tool.name);
      if (!mapping) continue;
      result.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        serverName: mapping.serverName,
        scope: mapping.scope,
        toolName: mapping.toolName,
      });
    }

    if (userId != null) {
      for (const [key, userTools] of this.userToolsMap) {
        if (!key.startsWith(`${userId}:`)) continue;
        const toolMap = this.userToolMaps.get(key);
        if (!toolMap) continue;
        for (const tool of userTools) {
          const mapping = toolMap.get(tool.name);
          if (!mapping) continue;
          result.push({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            serverName: mapping.serverName,
            scope: mapping.scope,
            toolName: mapping.toolName,
          });
        }
      }
    }

    return result;
  }

  isMcpTool(toolName: string): boolean {
    if (this.globalToolMap.has(toolName)) return true;
    for (const map of this.userToolMaps.values()) {
      if (map.has(toolName)) return true;
    }
    return false;
  }

  async execute(toolName: string, args: Record<string, unknown>): Promise<string> {
    let mapping = this.globalToolMap.get(toolName);
    if (!mapping) {
      for (const map of this.userToolMaps.values()) {
        mapping = map.get(toolName);
        if (mapping) break;
      }
    }
    if (!mapping) return `Unknown tool: ${toolName}`;

    try {
      log.debug({ tool: toolName, args }, "Calling MCP tool");
      const result = await mapping.client.callTool({
        name: mapping.toolName,
        arguments: args,
      });

      if (result.isError) {
        return `Tool error: ${extractText(result.content)}`;
      }
      return extractText(result.content);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `Tool error: ${msg}`;
    }
  }

  async connectUserServer(
    userId: number,
    serverId: number,
    name: string,
    config: Record<string, unknown>,
    inputs: Record<string, string>
  ): Promise<void> {
    const parsed = parseUserMcpConfig(config);
    const connected = await this.connectServer(name, parsed, "user", inputs, userId, serverId);
    if (!connected) throw new Error("Failed to connect user MCP server");
  }

  async disconnectUserServer(userId: number, serverId: number): Promise<void> {
    const key = userKey(userId, serverId);
    const servers = this.userConnectedServers.get(key);
    if (!servers) return;

    for (const { name, client } of servers) {
      try {
        await client.close();
        log.info({ server: name, userId }, "User MCP server disconnected");
      } catch (e) {
        log.error({ server: name, userId, err: e }, "Error disconnecting user MCP server");
      }
    }

    this.userConnectedServers.delete(key);
    this.userToolsMap.delete(key);
    this.userToolMaps.delete(key);
    this.userToolCounts.delete(key);
  }

  userToolCount(userId: number, serverId: number): number {
    return this.userToolCounts.get(userKey(userId, serverId)) ?? 0;
  }

  async shutdown(): Promise<void> {
    for (const { name, client } of this.globalConnectedServers) {
      try {
        await client.close();
        log.info({ server: name }, "MCP server disconnected");
      } catch (e) {
        log.error({ server: name, err: e }, "Error disconnecting MCP server");
      }
    }
    for (const [key, servers] of this.userConnectedServers) {
      for (const { name, client } of servers) {
        try {
          await client.close();
          log.info({ server: name, key }, "User MCP server disconnected");
        } catch (e) {
          log.error({ server: name, key, err: e }, "Error disconnecting user MCP server");
        }
      }
    }
    this.globalConnectedServers = [];
    this.globalTools = [];
    this.globalToolMap.clear();
    this.userConnectedServers.clear();
    this.userToolsMap.clear();
    this.userToolMaps.clear();
    this.userToolCounts.clear();
  }
}
