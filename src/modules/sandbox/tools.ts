import type { ToolDefinition } from "../../core/module.js";
import type { SandboxService } from "./service.js";

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n... [truncated, ${text.length - limit} chars omitted]`;
}

export function sandboxTools(service: SandboxService): ToolDefinition[] {
  return [
    {
      name: "sandbox_run_command",
      description:
        "Run a shell command inside this chat's isolated Vercel Sandbox. " +
        "The sandbox has internet access and comes with node, python, npm, pnpm, pip, uv, git, curl, and common build tools. " +
        "Use it to fetch data from the web, install packages, run scripts, compile code, or execute any other task the user asks for. " +
        "Commands run with a timeout; if a long-running server is needed, start it in the background and expose ports via sandbox_expose_port.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description:
              "The executable or shell command to run, e.g. 'curl', 'node', 'python3', 'npm'.",
          },
          args: {
            type: "array",
            items: { type: "string" },
            description: "Command arguments as separate strings.",
          },
          cwd: {
            type: "string",
            description:
              "Optional working directory inside the sandbox. Defaults to /vercel/sandbox.",
          },
          timeout_ms: {
            type: "number",
            description: "Optional command timeout in milliseconds. Default is 60 seconds.",
          },
        },
        required: ["command"],
      },
      execute: async (args, tenant) => {
        const chatId = tenant.chatId;
        const result = await service.runCommand(
          chatId,
          String(args.command),
          Array.isArray(args.args) ? args.args.map(String) : [],
          {
            cwd: args.cwd ? String(args.cwd) : undefined,
            timeoutMs: typeof args.timeout_ms === "number" ? args.timeout_ms : undefined,
          }
        );
        const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
        const summary = `exit_code: ${result.exitCode}\n${truncate(output, 8000)}`;
        return summary;
      },
    },
    {
      name: "sandbox_write_file",
      description:
        "Create or overwrite a text file inside the sandbox. Paths are relative to /vercel/sandbox unless absolute.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path inside the sandbox." },
          content: { type: "string", description: "Full text content of the file." },
        },
        required: ["path", "content"],
      },
      execute: async (args, tenant) => {
        await service.writeFile(tenant.chatId, String(args.path), String(args.content));
        return `Wrote ${String(args.path)}`;
      },
    },
    {
      name: "sandbox_read_file",
      description:
        "Read a text file from the sandbox. Returns an error if the file does not exist.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path inside the sandbox." },
        },
        required: ["path"],
      },
      execute: async (args, tenant) => {
        const content = await service.readFile(tenant.chatId, String(args.path));
        if (content === null) return `File not found: ${String(args.path)}`;
        return truncate(content, 12000);
      },
    },
    {
      name: "sandbox_list_files",
      description: "List files and directories inside the sandbox at the given path.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Directory path inside the sandbox. Defaults to /vercel/sandbox.",
          },
        },
      },
      execute: async (args, tenant) => {
        const files = await service.listFiles(
          tenant.chatId,
          args.path ? String(args.path) : undefined
        );
        if (files.length === 0) return "(empty directory)";
        return files.join("\n");
      },
    },
    {
      name: "sandbox_reset",
      description:
        "Delete the current chat's sandbox and recreate a fresh one. Use this when the environment is in a broken state or the user wants a clean workspace.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async (_args, tenant) => {
        await service.reset(tenant.chatId);
        return "Sandbox reset complete. A fresh environment is ready.";
      },
    },
  ];
}
