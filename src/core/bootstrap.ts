import { z, type ZodObject, type ZodRawShape } from "zod";
import type { Bot } from "grammy";
import type { Express } from "express";
import { getDb, runMigrations } from "./db.js";
import { EventBus } from "./events.js";
import {
  type Contributions,
  type ModuleContext,
  type SkyeModule,
  ServiceRegistry,
} from "./module.js";
import { log } from "../utils/log.js";

/**
 * Compose env schemas from all modules and parse process.env once.
 * Throws if any required variable is missing or malformed.
 */
export function composeAndParseEnv(
  modules: readonly SkyeModule[]
): Readonly<Record<string, unknown>> {
  let shape: ZodRawShape = {};
  for (const mod of modules) {
    if (!mod.envSchema) continue;
    shape = { ...shape, ...(mod.envSchema as ZodObject<ZodRawShape>).shape };
  }
  const schema = z.object(shape);
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return Object.freeze(result.data);
}

/**
 * Initialize all modules in declared order. Collects their service objects
 * (into ctx.services) and their tool/command/handler/route contributions.
 */
export async function initModules(
  modules: readonly SkyeModule[],
  ctx: ModuleContext
): Promise<Contributions> {
  const contributions: Contributions = {
    tools: [],
    commands: [],
    telegramHandlers: [],
    panelRoutes: [],
  };

  for (const mod of modules) {
    if (!mod.init) continue;
    const result = await mod.init(ctx);
    if (!result) continue;

    if (result.service !== undefined) {
      ctx.services.set(mod.name, result.service);
    }
    if (result.tools) contributions.tools.push(...result.tools);
    if (result.commands) contributions.commands.push(...result.commands);
    if (result.telegramHandlers) {
      contributions.telegramHandlers.push(...result.telegramHandlers);
    }
    if (result.panelRoutes) contributions.panelRoutes.push(...result.panelRoutes);
  }

  return contributions;
}

/**
 * Run start() on each module that defines it. The `extra` bag carries the
 * shared bot and express app — `telegram` and `panel` modules consume them.
 */
export async function startModules(
  modules: readonly SkyeModule[],
  ctx: ModuleContext,
  contributions: Contributions,
  extra: { bot?: Bot; app?: Express } = {}
): Promise<void> {
  for (const mod of modules) {
    if (!mod.start) continue;
    await mod.start(ctx, contributions, extra);
  }
}

/**
 * Call shutdown on each module in reverse order.
 */
export async function shutdownModules(modules: readonly SkyeModule[]): Promise<void> {
  for (let i = modules.length - 1; i >= 0; i--) {
    const mod = modules[i];
    if (!mod.shutdown) continue;
    try {
      await mod.shutdown();
    } catch (e) {
      log.error({ module: mod.name, err: e }, "Module shutdown failed");
    }
  }
}

/** One-shot helper: build a ModuleContext from already-parsed env. */
export function makeContext(config: Readonly<Record<string, unknown>>): ModuleContext {
  return {
    db: getDb(),
    events: new EventBus(),
    config,
    logger: log,
    services: new ServiceRegistry(),
  };
}

/** Convenience: runMigrations is re-exported so index.ts can stay tidy. */
export { runMigrations };
