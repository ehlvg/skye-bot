import "./core/config.js";
import {
  composeAndParseEnv,
  initModules,
  makeContext,
  runMigrations,
  shutdownModules,
  startModules,
} from "./core/bootstrap.js";
import { getDb } from "./core/db.js";
import { log } from "./utils/log.js";
import type { SkyeModule } from "./core/module.js";

import { auditModule } from "./modules/audit/index.js";
import { chatConfigModule } from "./modules/chatConfig/index.js";
import { chatLogModule } from "./modules/chatLog/index.js";
import { llmModule } from "./modules/llm/index.js";
import { mcpModule } from "./modules/mcp/index.js";
import { memoryModule } from "./modules/memory/index.js";
import { panelModule } from "./modules/panel/index.js";
import { proactiveModule } from "./modules/proactive/index.js";
import { sandboxModule } from "./modules/sandbox/index.js";
import { speechModule } from "./modules/speech/index.js";
import { telegramModule } from "./modules/telegram/index.js";
import { userConfigModule } from "./modules/userConfig/index.js";

/**
 * Module load order matters:
 *   - llm initialized before chatLog (chatLog uses it for summarization)
 *   - userConfig initialized before mcp (mcp reads user servers from it)
 *   - audit, memory, chatConfig come before panel (their routes contribute)
 *   - telegram is last (consumes every other service)
 *   - panel start() runs after all modules' init() returned their routes
 */
const modules: readonly SkyeModule[] = [
  llmModule,
  userConfigModule,
  chatConfigModule,
  memoryModule,
  chatLogModule,
  speechModule,
  auditModule,
  mcpModule,
  sandboxModule,
  proactiveModule,
  panelModule,
  telegramModule,
];

async function main(): Promise<void> {
  const env = composeAndParseEnv(modules);
  const db = getDb();
  runMigrations(db, modules, log);

  const ctx = makeContext(env);
  const contributions = await initModules(modules, ctx);
  await startModules(modules, ctx, contributions);
}

async function shutdown(signal: string): Promise<void> {
  log.info(`Received ${signal}, shutting down...`);
  await shutdownModules(modules);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((e) => {
  log.error({ err: e }, "Fatal startup error");
  process.exit(1);
});
