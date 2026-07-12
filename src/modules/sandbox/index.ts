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
    const configuredApiKey = ctx.config.DAYTONA_API_KEY ?? ctx.config.SANDBOX_DAYTONA_API_KEY;
    const apiKey = configuredApiKey ? String(configuredApiKey) : undefined;
    const apiUrl = ctx.config.DAYTONA_API_URL ?? ctx.config.SANDBOX_DAYTONA_API_URL;
    const target = ctx.config.DAYTONA_TARGET ?? ctx.config.SANDBOX_DAYTONA_TARGET;

    const enabled = Boolean(ctx.config.SANDBOX_ENABLED) && apiKey != null;

    const service = new SandboxService({
      enabled,
      apiKey,
      apiUrl: apiUrl ? String(apiUrl) : undefined,
      target: target ? String(target) : undefined,
      image: String(ctx.config.SANDBOX_IMAGE),
      snapshot: ctx.config.SANDBOX_SNAPSHOT ? String(ctx.config.SANDBOX_SNAPSHOT) : undefined,
      cpu: Number(ctx.config.SANDBOX_CPU),
      memoryGiB: Number(ctx.config.SANDBOX_MEMORY_GIB),
      diskGiB: Number(ctx.config.SANDBOX_DISK_GIB),
      autoStopMinutes: Number(ctx.config.SANDBOX_AUTO_STOP_MINUTES),
      autoArchiveMinutes: Number(ctx.config.SANDBOX_AUTO_ARCHIVE_MINUTES),
      persistent: Boolean(ctx.config.SANDBOX_PERSISTENT),
      commandTimeoutMs: Number(ctx.config.SANDBOX_COMMAND_TIMEOUT_MS),
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
              description: "Run a command in this chat's Daytona Sandbox",
              handler: async (ctx, tenant) => {
                const command = ctx.match?.toString().trim();
                if (!command) {
                  await ctx.reply(
                    "Usage: /sandbox <command>\nExample: /sandbox curl -s https://api.github.com/users/daytonaio"
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
              description: "Reset this chat's Daytona Sandbox to a clean state",
              handler: async (ctx, tenant) => {
                await ctx.api.sendChatAction(tenant.chatId, "typing");
                await service.reset(tenant.chatId);
                await ctx.reply("Sandbox reset. A fresh environment is ready.");
              },
            },
            {
              name: "sandbox_status",
              description: "Show this chat's Daytona Sandbox status",
              handler: async (ctx, tenant) => {
                const status = await service.status(tenant.chatId);
                if (!status) {
                  await ctx.reply("No active sandbox for this chat yet.");
                  return;
                }
                await ctx.reply(
                  `Name: ${status.name}\nStatus: ${status.status}\nResources: ${status.cpu} CPU, ${status.memoryGiB} GiB RAM, ${status.diskGiB} GiB disk\nAuto-stop: ${status.autoStopMinutes ?? "unknown"} minutes\nPersistent: ${status.persistent}`
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
