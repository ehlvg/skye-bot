import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { log } from "./utils/log.js";

interface McpInput {
  id: string;
  description?: string;
  password?: boolean;
}

interface McpServerConfig {
  type?: "stdio" | "http";
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  // http
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
}

interface McpConnectedServer {
  name: string;
  client: Client;
}

const toolMap = new Map<string, McpToolMapping>();
let allTools: any[] = [];
let connectedServers: McpConnectedServer[] = [];
let initialized = false;

function resolveVars(value: string): string {
  return value.replace(/\$\{(\w+)\}|\$\{input:([^}]+)\}/g, (_, envName, inputId) => {
    if (envName) return process.env[envName] ?? "";
    return process.env[inputId] ?? "";
  });
}

function resolveConfig(config: McpServerConfig): McpServerConfig {
  return {
    type: config.type,
    command: config.command ? resolveVars(config.command) : undefined,
    args: config.args?.map(resolveVars),
    cwd: config.cwd ? resolveVars(config.cwd) : undefined,
    env: config.env
      ? Object.fromEntries(Object.entries(config.env).map(([k, v]) => [k, resolveVars(v)]))
      : undefined,
    url: config.url ? resolveVars(config.url) : undefined,
    headers: config.headers
      ? Object.fromEntries(Object.entries(config.headers).map(([k, v]) => [k, resolveVars(v)]))
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

export async function initMcp(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const config = loadMcpConfig();
  if (!config?.mcpServers || Object.keys(config.mcpServers).length === 0) {
    log.info("No mcp.json found or empty — MCP tools disabled");
    return;
  }

  const entries = Object.entries(config.mcpServers);
  log.info(`Connecting to ${entries.length} MCP server(s)...`);

  for (const [name, rawCfg] of entries) {
    try {
      const cfg = resolveConfig(rawCfg);
      const client = new Client(
        { name: `skye-${name}`, version: "1.0.0" },
        { capabilities: {} }
      );

      // Infer transport from explicit type or from config shape
      const transportType = cfg.type ?? (cfg.url ? "http" : "stdio");

      if (transportType === "http") {
        if (!cfg.url) {
          log.warn({ server: name }, "HTTP MCP server missing url, skipping");
          continue;
        }

        const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
          requestInit: {
            headers: cfg.headers ?? {},
          },
        });

        await client.connect(transport);
      } else {
        if (!cfg.command) {
          log.warn({ server: name }, "Stdio MCP server missing command, skipping");
          continue;
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

      for (const tool of tools) {
        if (toolMap.has(tool.name)) {
          log.warn({ tool: tool.name, server: name }, "Tool name collision, skipping");
          continue;
        }
        const openaiTool = {
          type: "function" as const,
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema ?? { type: "object", properties: {} },
        };
        allTools.push(openaiTool);
        toolMap.set(tool.name, { serverName: name, client, toolName: tool.name });
      }

      connectedServers.push({ name, client });
      log.info({ server: name, tools: tools.length }, `MCP server connected`);
    } catch (e) {
      log.error({ server: name, err: e }, `Failed to connect to MCP server "${name}"`);
    }
  }

  if (allTools.length > 0) {
    log.info(`MCP initialized — ${allTools.length} tools from ${connectedServers.length} server(s)`);
  }
}

export function getMcpTools(): any[] {
  return allTools;
}

export function isMcpTool(toolName: string): boolean {
  return toolMap.has(toolName);
}

export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  const mapping = toolMap.get(toolName);
  if (!mapping) return `Unknown tool: ${toolName}`;

  try {
    log.debug({ tool: toolName, args }, "Calling MCP tool");
    const result = await mapping.client.callTool({
      name: mapping.toolName,
      arguments: args,
    });

    log.debug(
      { tool: toolName, isError: result.isError, contentType: typeof result.content },
      "MCP tool raw result"
    );

    if (result.isError) {
      const text = extractText(result.content);
      return `Tool error: ${text}`;
    }

    return extractText(result.content);
  } catch (e: any) {
    return `Tool error: ${e?.message ?? e}`;
  }
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
  for (const { name, client } of connectedServers) {
    try {
      await client.close();
      log.info({ server: name }, "MCP server disconnected");
    } catch (e) {
      log.error({ server: name, err: e }, "Error disconnecting MCP server");
    }
  }
  connectedServers = [];
  allTools = [];
  toolMap.clear();
}
