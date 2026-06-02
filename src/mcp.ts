import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { log } from "./utils/log.js";
import { getAllUserMcpServers, getUserMcpInputs } from "./userConfig.js";

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

const globalToolMap = new Map<string, McpToolMapping>();
let globalTools: any[] = [];
let globalConnectedServers: McpConnectedServer[] = [];
let initialized = false;

const userToolMaps = new Map<string, Map<string, McpToolMapping>>();
const userToolsMap = new Map<string, any[]>();
const userConnectedServers = new Map<string, McpConnectedServer[]>();
const userToolCounts = new Map<string, number>();

function userKey(userId: number, serverId: number): string {
  return `${userId}:${serverId}`;
}

function resolveVars(value: string, extraVars?: Record<string, string>): string {
  return value.replace(/\$\{(\w+)\}|\$\{input:([^}]+)\}/g, (_, envName, inputId) => {
    if (extraVars && inputId && extraVars[inputId]) return extraVars[inputId];
    if (envName) return process.env[envName] ?? "";
    return process.env[inputId] ?? "";
  });
}

function resolveConfig(config: McpServerConfig, extraVars?: Record<string, string>): McpServerConfig {
  return {
    type: config.type,
    command: config.command ? resolveVars(config.command, extraVars) : undefined,
    args: config.args?.map((a) => resolveVars(a, extraVars)),
    cwd: config.cwd ? resolveVars(config.cwd, extraVars) : undefined,
    env: config.env
      ? Object.fromEntries(Object.entries(config.env).map(([k, v]) => [k, resolveVars(v, extraVars)]))
      : undefined,
    url: config.url ? resolveVars(config.url, extraVars) : undefined,
    headers: config.headers
      ? Object.fromEntries(Object.entries(config.headers).map(([k, v]) => [k, resolveVars(v, extraVars)]))
      : undefined,
  };
}

function loadMcpConfig(): McpConfig | null {
  const configPath = process.env.MCP_CONFIG_PATH ?? join(process.cwd(), "mcp.json");
  if (!existsSync(configPath)) return null;
  try {
    const raw = readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch (e) {
    log.error({ err: e }, "Failed to parse mcp.json");
    return null;
  }
}

async function connectServer(
  name: string,
  rawCfg: McpServerConfig,
  scope: "global" | "user",
  extraVars?: Record<string, string>,
  userId?: number,
  serverId?: number
): Promise<{ client: Client; tools: any[] } | null> {
  try {
    const cfg = resolveConfig(rawCfg, extraVars);
    const client = new Client(
      { name: `skye-${name}`, version: "1.0.0" },
      { capabilities: {} }
    );

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
    const openaiTools: any[] = [];
    const toolMap = scope === "global" ? globalToolMap : getOrCreateUserToolMap(userId!, serverId!);

    for (const tool of tools) {
      if (scope === "global" && globalToolMap.has(tool.name)) {
        log.warn({ tool: tool.name, server: name }, "Tool name collision, skipping");
        continue;
      }
      const openaiTool = {
        type: "function" as const,
        name: scope === "global" ? tool.name : `u${userId}_${serverId}_${tool.name}`,
        description: tool.description ?? "",
        parameters: tool.inputSchema ?? { type: "object", properties: {} },
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
      globalTools.push(...openaiTools);
      globalConnectedServers.push(entry);
    } else {
      const key = userKey(userId!, serverId!);
      userToolsMap.set(key, openaiTools);
      if (!userConnectedServers.has(key)) userConnectedServers.set(key, []);
      userConnectedServers.get(key)!.push(entry);
      userToolCounts.set(key, openaiTools.length);
    }

    log.info({ server: name, tools: tools.length, scope }, `MCP server connected`);
    return { client, tools: openaiTools };
  } catch (e) {
    log.error({ server: name, err: e }, `Failed to connect to MCP server "${name}"`);
    return null;
  }
}

function getOrCreateUserToolMap(userId: number, serverId: number): Map<string, McpToolMapping> {
  const key = userKey(userId, serverId);
  if (!userToolMaps.has(key)) userToolMaps.set(key, new Map());
  return userToolMaps.get(key)!;
}

export async function initMcp(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const config = loadMcpConfig();
  if (config?.mcpServers && Object.keys(config.mcpServers).length > 0) {
    const entries = Object.entries(config.mcpServers);
    log.info(`Connecting to ${entries.length} global MCP server(s)...`);

    for (const [name, rawCfg] of entries) {
      await connectServer(name, rawCfg, "global");
    }

    if (globalTools.length > 0) {
      log.info(
        `Global MCP initialized — ${globalTools.length} tools from ${globalConnectedServers.length} server(s)`
      );
    }
  } else {
    log.info("No mcp.json found or empty — global MCP tools disabled");
  }

  const userServers = getAllUserMcpServers();
  if (userServers.length > 0) {
    log.info(`Connecting to ${userServers.length} user MCP server(s)...`);
    for (const server of userServers) {
      const inputs = getUserMcpInputs(server.id);
      await connectServer(
        server.name,
        server.config as McpServerConfig,
        "user",
        inputs,
        server.userId,
        server.id
      );
    }
  }
}

export function getMcpTools(userId?: number): any[] {
  const tools = [...globalTools];
  if (userId != null) {
    for (const [key, userTools] of userToolsMap) {
      if (key.startsWith(`${userId}:`)) {
        tools.push(...userTools);
      }
    }
  }
  return tools;
}

export function isMcpTool(toolName: string): boolean {
  if (globalToolMap.has(toolName)) return true;
  for (const map of userToolMaps.values()) {
    if (map.has(toolName)) return true;
  }
  return false;
}

export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  let mapping = globalToolMap.get(toolName);
  if (!mapping) {
    for (const map of userToolMaps.values()) {
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
  } catch (e: any) {
    return `Tool error: ${e?.message ?? e}`;
  }
}

export async function connectUserMcpServer(
  userId: number,
  serverId: number,
  name: string,
  config: Record<string, unknown>,
  inputs: Record<string, string>
): Promise<void> {
  await connectServer(name, config as McpServerConfig, "user", inputs, userId, serverId);
}

export async function disconnectUserMcpServer(
  userId: number,
  serverId: number
): Promise<void> {
  const key = userKey(userId, serverId);
  const servers = userConnectedServers.get(key);
  if (!servers) return;

  for (const { name, client } of servers) {
    try {
      await client.close();
      log.info({ server: name, userId }, "User MCP server disconnected");
    } catch (e) {
      log.error({ server: name, userId, err: e }, "Error disconnecting user MCP server");
    }
  }

  userConnectedServers.delete(key);
  userToolsMap.delete(key);
  userToolMaps.delete(key);
  userToolCounts.delete(key);
}

export function getUserMcpToolCount(userId: number, serverId: number): number {
  return userToolCounts.get(userKey(userId, serverId)) ?? 0;
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

export async function shutdownMcp(): Promise<void> {
  for (const { name, client } of globalConnectedServers) {
    try {
      await client.close();
      log.info({ server: name }, "MCP server disconnected");
    } catch (e) {
      log.error({ server: name, err: e }, "Error disconnecting MCP server");
    }
  }

  for (const [key, servers] of userConnectedServers) {
    for (const { name, client } of servers) {
      try {
        await client.close();
        log.info({ server: name, key }, "User MCP server disconnected");
      } catch (e) {
        log.error({ server: name, key, err: e }, "Error disconnecting user MCP server");
      }
    }
  }

  globalConnectedServers = [];
  globalTools = [];
  globalToolMap.clear();
  userConnectedServers.clear();
  userToolsMap.clear();
  userToolMaps.clear();
  userToolCounts.clear();
}
