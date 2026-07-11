import type { SkyeModule } from "../../core/module.js";
import { sandboxEnvSchema } from "./env.js";
import { SandboxService } from "./service.js";
import { sandboxTools } from "./tools.js";

declare module "../../core/module.js" {
  interface SkyeServices {
    sandbox: SandboxService;
  }
}

let serviceRef: SandboxService | null = null;

export const sandboxModule: SkyeModule = {
  name: "sandbox",
  envSchema: sandboxEnvSchema,
  init(ctx) {
    const token = ctx.config.VERCEL_ACCESS_TOKEN
      ? String(ctx.config.VERCEL_ACCESS_TOKEN)
      : undefined;
    const teamId = ctx.config.VERCEL_TEAM_ID ? String(ctx.config.VERCEL_TEAM_ID) : undefined;
    const projectId = ctx.config.VERCEL_PROJECT_ID
      ? String(ctx.config.VERCEL_PROJECT_ID)
      : undefined;

    const enabled =
      Boolean(ctx.config.SANDBOX_ENABLED) &&
      (token != null || process.env.VERCEL_OIDC_TOKEN != null);

    const service = new SandboxService({
      enabled,
      token,
      teamId,
      projectId,
      runtime: String(ctx.config.SANDBOX_RUNTIME),
      timeoutMs: Number(ctx.config.SANDBOX_TIMEOUT_MS),
      vcpus: Number(ctx.config.SANDBOX_VCPUS),
      persistent: Boolean(ctx.config.SANDBOX_PERSISTENT),
      commandTimeoutMs: Number(ctx.config.SANDBOX_COMMAND_TIMEOUT_MS),
      networkPolicy: ctx.config.SANDBOX_NETWORK_POLICY as "deny-all" | "allow-all",
      maxOutputChars: Number(ctx.config.SANDBOX_MAX_OUTPUT_CHARS),
      maxFileBytes: Number(ctx.config.SANDBOX_MAX_FILE_BYTES),
      maxArgs: Number(ctx.config.SANDBOX_MAX_ARGS),
      maxArgChars: Number(ctx.config.SANDBOX_MAX_ARG_CHARS),
    });

    serviceRef = service;
    return {
      service,
      tools: enabled ? sandboxTools(service) : [],
      commands: enabled
        ? [
            {
              name: "sandbox",
              description: "Run a command in this chat's Vercel Sandbox",
              handler: async (ctx, tenant) => {
                const command = ctx.match?.toString().trim();
                if (!command) {
                  await ctx.reply(
                    "Usage: /sandbox <command>\nExample: /sandbox curl -s https://api.github.com/users/vercel"
                  );
                  return;
                }
                await ctx.api.sendChatAction(tenant.chatId, "typing");
                const parts = command.split(/\s+/);
                const result = await service.runCommand(tenant.chatId, parts[0], parts.slice(1));
                const output = [result.stdout, result.stderr]
                  .filter(Boolean)
                  .join("\n")
                  .slice(0, 3800);
                await ctx.reply(`Exit code: ${result.exitCode}\n\n${output || "(no output)"}`, {
                  reply_to_message_id: ctx.message?.message_id,
                });
              },
            },
            {
              name: "sandbox_reset",
              description: "Reset this chat's Vercel Sandbox to a clean state",
              handler: async (ctx, tenant) => {
                await ctx.api.sendChatAction(tenant.chatId, "typing");
                await service.reset(tenant.chatId);
                await ctx.reply("Sandbox reset. A fresh environment is ready.");
              },
            },
            {
              name: "sandbox_status",
              description: "Show this chat's Vercel Sandbox status",
              handler: async (ctx, tenant) => {
                const status = await service.status(tenant.chatId);
                if (!status) {
                  await ctx.reply("No active sandbox for this chat yet.");
                  return;
                }
                await ctx.reply(
                  `Name: ${status.name}\nStatus: ${status.status}\nRuntime: ${status.runtime ?? "unknown"}\nTimeout: ${status.timeout ?? "unknown"}ms\nPersistent: ${status.persistent}`
                );
              },
            },
          ]
        : [],
    };
  },
  async shutdown() {
    if (serviceRef) {
      await serviceRef.shutdown();
      serviceRef = null;
    }
  },
};
