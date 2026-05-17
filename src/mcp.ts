import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { log } from "./utils/log.js";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
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
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
}

function resolveConfig(config: McpServerConfig): McpServerConfig {
  const resolved: McpServerConfig = {
    command: resolveVars(config.command),
    args: config.args?.map(resolveVars),
    cwd: config.cwd ? resolveVars(config.cwd) : undefined,
    env: config.env
      ? Object.fromEntries(Object.entries(config.env).map(([k, v]) => [k, resolveVars(v)]))
      : undefined,
  };
  return resolved;
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
  if (!config?.mcpServers) {
    log.info("No mcp.json found or empty — MCP tools disabled");
    return;
  }

  const entries = Object.entries(config.mcpServers);
  if (entries.length === 0) return;

  log.info(`Connecting to ${entries.length} MCP server(s)...`);

  for (const [name, rawCfg] of entries) {
    try {
      const cfg = resolveConfig(rawCfg);
      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: { ...process.env, ...cfg.env } as Record<string, string>,
        cwd: cfg.cwd,
        stderr: "inherit",
      });

      const client = new Client(
        { name: `skye-${name}`, version: "1.0.0" },
        { capabilities: {} }
      );

      await client.connect(transport);

      const result = await client.listTools();
      const tools = result.tools ?? [];

      for (const tool of tools) {
        if (toolMap.has(tool.name)) {
          log.warn({ tool: tool.name, server: name }, "Tool name collision, skipping");
          continue;
        }
        const openaiTool = {
          type: "function" as const,
          function: {
            name: tool.name,
            description: tool.description ?? "",
            parameters: tool.inputSchema ?? { type: "object", properties: {} },
          },
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
    const result = await mapping.client.callTool({
      name: mapping.toolName,
      arguments: args,
    });

    if (result.isError) {
      const text = extractText(result.content);
      return `Tool error: ${text}`;
    }

    return extractText(result.content);
  } catch (e: any) {
    return `Tool error: ${e?.message ?? e}`;
  }
}

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content);

  return content
    .filter((c: any) => c.type === "text")
    .map((c: any) => c.text)
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
