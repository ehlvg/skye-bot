import {
  initModules,
  makeContext,
  runMigrations,
  shutdownModules,
  startModules,
} from "./core/bootstrap.js";
import { getDb } from "./core/db.js";
import { loadConfig } from "./core/config.js";
import { setLogLevel, log } from "./utils/log.js";
import { modules } from "./modules.js";

async function main(): Promise<void> {
  const config = loadConfig(modules);
  setLogLevel(String(config.log_level));

  const db = getDb(String(config.db_path));
  runMigrations(db, modules, log);

  const ctx = makeContext(config);
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
