import type { SkyeModule, ToolDefinition } from "../../core/module.js";
import type { WorkspaceService } from "./service.js";
import { createWorkspaceService } from "./service.js";
import { workspaceEnvSchema } from "./env.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    workspace: WorkspaceService;
  }
}

function buildTools(svc: WorkspaceService): ToolDefinition[] {
  return [
    {
      name: "exec_command",
      description:
        "Execute a shell command in the user's persistent workspace container. " +
        "The workspace has bash, Node.js, and Python available. " +
        "Files written here persist across sessions. " +
        "Use this to run code, install packages, or perform file operations.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute in the workspace.",
          },
          timeout: {
            type: "number",
            description: "Optional timeout in seconds (default 30).",
          },
        },
        required: ["command"],
      },
      execute: async (args, tenant) => {
        const userId = tenant.userId ?? tenant.chatId;
        const command = String(args.command ?? "");
        const timeout = typeof args.timeout === "number" ? args.timeout : undefined;
        const result = await svc.exec(userId, command, timeout);
        const parts: string[] = [];
        if (result.stdout) parts.push(result.stdout.trimEnd());
        if (result.stderr) parts.push(`[stderr]\n${result.stderr.trimEnd()}`);
        if (result.timedOut) parts.push(`[timed out after ${timeout ?? 30}s]`);
        return parts.join("\n") || `Command exited with code ${result.exitCode}`;
      },
    },
    {
      name: "write_file",
      description:
        "Write a file to the user's persistent workspace. " +
        "The path is relative to /workspace. " +
        "Parent directories are created automatically.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to /workspace (e.g. 'src/main.ts').",
          },
          content: {
            type: "string",
            description: "The full file content to write.",
          },
        },
        required: ["path", "content"],
      },
      execute: async (args, tenant) => {
        const userId = tenant.userId ?? tenant.chatId;
        const path = String(args.path ?? "");
        const content = String(args.content ?? "");
        await svc.write(userId, path, content);
        return `File written: /workspace/${path}`;
      },
    },
    {
      name: "read_file",
      description:
        "Read a file from the user's persistent workspace. The path is relative to /workspace.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File path relative to /workspace (e.g. 'src/main.ts').",
          },
        },
        required: ["path"],
      },
      execute: async (args, tenant) => {
        const userId = tenant.userId ?? tenant.chatId;
        const path = String(args.path ?? "");
        try {
          const content = await svc.read(userId, path);
          return content;
        } catch (e) {
          return `Error reading file: ${String(e)}`;
        }
      },
    },
  ];
}

export const workspaceModule: SkyeModule = {
  name: "workspace",
  envSchema: workspaceEnvSchema,
  init(ctx) {
    const svc = createWorkspaceService(ctx);
    ctx.services.set("workspace", svc);
    return { service: svc, tools: buildTools(svc) };
  },
  async shutdown() {
    // Will be wired via ModuleContext shutdown
  },
};
