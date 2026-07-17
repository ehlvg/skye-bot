import { Bot } from "grammy";
import { createHash } from "crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import type { SkyeModule } from "../../core/module.js";
import { telegramEnvSchema } from "./env.js";
import { installTelegram } from "./handlers.js";
import { migrations } from "./migrations.js";
import { TelegramReliabilityService } from "./reliability.js";
import { log } from "../../utils/log.js";

let botRef: Bot | null = null;
let reliabilityRef: TelegramReliabilityService | null = null;
let releasePollingLock: (() => void) | null = null;

declare module "../../core/module.js" {
  interface SkyeServices {
    telegramBot: Bot;
    telegramReliability: TelegramReliabilityService;
  }
}

export const telegramModule: SkyeModule = {
  name: "telegram",
  envSchema: telegramEnvSchema,
  migrations,
  async init(ctx) {
    const token = String(ctx.config.BOT_TOKEN);
    const bot = new Bot(token);
    botRef = bot;
    // Register under the declared SkyeServices key so `ctx.services.get("telegramBot")`
    // resolves in other modules (billing routes, channel tools, panel, etc.).
    // Returning { service } would instead key it as "telegram" (the module name).
    ctx.services.set("telegramBot", bot);
    const reliability = new TelegramReliabilityService(
      ctx.db,
      Number(ctx.config.TELEGRAM_JOB_TIMEOUT_MS)
    );
    reliabilityRef = reliability;
    ctx.services.set("telegramReliability", reliability);
  },
  async start(ctx, contributions, extra) {
    const bot = botRef!;
    const reliability = reliabilityRef!;
    extra.bot = bot;

    // Validate the Telegram token and cache botInfo before accepting updates.
    await bot.init();
    reliability.markApiReady(bot.botInfo.username);

    // Pre-flight: probe model capability before serving requests. This probe is
    // intentionally advisory; providers may not expose /models even when chat works.
    const llm = ctx.services.get("llm");
    await llm.checkCapabilities();
    reliability.markLlmPreflightComplete();

    installTelegram(
      bot,
      {
        llm,
        mcp: ctx.services.get("mcp"),
        memory: ctx.services.get("memory"),
        chatLog: ctx.services.get("chatLog"),
        chatConfig: ctx.services.get("chatConfig"),
        userConfig: ctx.services.get("userConfig"),
        speech: ctx.services.get("speech"),
        audit: ctx.services.get("audit"),
        sandbox: ctx.services.has("sandbox") ? ctx.services.get("sandbox") : undefined,
        proactive: ctx.services.has("proactive") ? ctx.services.get("proactive") : undefined,
        reminders: ctx.services.has("reminders") ? ctx.services.get("reminders") : undefined,
        jobs: ctx.services.get("jobs"),
        channel: ctx.services.has("channel") ? ctx.services.get("channel") : undefined,
        events: ctx.events,
        billing: ctx.services.get("billing"),
        admin: ctx.services.get("admin"),
        botToken: String(ctx.config.BOT_TOKEN),
        maxAttachmentBytes: Number(ctx.config.TELEGRAM_MAX_ATTACHMENT_BYTES),
        webappUrl: String(ctx.config.PANEL_WEBAPP_URL),
        defaultModelId: String(ctx.config.DEFAULT_MODEL_ID ?? "sydney"),
        reliability,
        ...(String(ctx.config.OWNER_NAME ?? "") || String(ctx.config.OWNER_TAG ?? "")
          ? { owner: { name: String(ctx.config.OWNER_NAME), tag: String(ctx.config.OWNER_TAG) } }
          : {}),
      },
      contributions
    );

    void bot.api
      .setChatMenuButton({
        menu_button: {
          type: "web_app",
          text: "Settings",
          web_app: { url: String(ctx.config.PANEL_WEBAPP_URL) },
        },
      })
      .catch((e) => log.warn({ err: e }, "Failed to set menu button"));

    if (String(ctx.config.TELEGRAM_POLLING_LOCK ?? "1") !== "0") {
      releasePollingLock = acquirePollingLock(String(ctx.config.BOT_TOKEN));
    }

    reliability.markPolling();
    const dropPendingUpdates = String(ctx.config.TELEGRAM_DROP_PENDING_UPDATES ?? "0") === "1";
    void bot.start({ drop_pending_updates: dropPendingUpdates }).catch((e) => {
      reliability.markStopped();
      releasePollingLock?.();
      releasePollingLock = null;
      if (isGetUpdatesConflict(e)) {
        log.error(
          {
            err: e,
            hint: "Another process or deployment is already polling this BOT_TOKEN. Stop the other instance, or switch one deployment to webhooks/different token.",
          },
          "Telegram polling conflict"
        );
      } else {
        log.error({ err: e }, "Telegram polling stopped unexpectedly");
      }
      setTimeout(() => process.exit(1), 100).unref();
    });
    log.info({ dropPendingUpdates }, "Skye is alive");
  },
  async shutdown() {
    reliabilityRef?.markStopped();
    if (botRef) {
      await botRef.stop().catch(() => {});
    }
    releasePollingLock?.();
    releasePollingLock = null;
    reliabilityRef = null;
  },
};

function pollingLockPath(token: string): string {
  const hash = createHash("sha256").update(token).digest("hex").slice(0, 12);
  const dbPath = process.env.DB_PATH;
  const dir = dbPath && dbPath !== ":memory:" ? dirname(dbPath) : join(process.cwd(), "data");
  return join(dir, `skye-${hash}.polling.lock`);
}

function acquirePollingLock(token: string): () => void {
  const path = pollingLockPath(token);
  mkdirSync(dirname(path), { recursive: true });

  const tryAcquire = () => {
    const fd = openSync(path, "wx");
    writeFileSync(
      fd,
      JSON.stringify(
        {
          pid: process.pid,
          startedAt: new Date().toISOString(),
          cwd: process.cwd(),
          node: process.version,
        },
        null,
        2
      )
    );
    return fd;
  };

  let fd: number;
  try {
    fd = tryAcquire();
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "EEXIST") throw e;

    const holder = readLock(path);
    if (holder.pid && isProcessAlive(holder.pid)) {
      throw new Error(
        `Telegram polling is already locked by PID ${holder.pid}. Stop the other bot process or remove ${path} if it is stale.`
      );
    }

    unlinkSync(path);
    fd = tryAcquire();
  }

  log.debug({ path }, "Acquired Telegram polling lock");
  return () => {
    try {
      closeSync(fd);
    } catch {
      // ignore
    }
    try {
      if (existsSync(path)) unlinkSync(path);
      log.debug({ path }, "Released Telegram polling lock");
    } catch (e) {
      log.warn({ err: e, path }, "Failed to release Telegram polling lock");
    }
  };
}

function readLock(path: string): { pid?: number } {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === "number" ? { pid: parsed.pid } : {};
  } catch {
    return {};
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code !== "ESRCH";
  }
}

function isGetUpdatesConflict(e: unknown): boolean {
  const err = e as { method?: unknown; error_code?: unknown; description?: unknown };
  return (
    err.method === "getUpdates" &&
    err.error_code === 409 &&
    typeof err.description === "string" &&
    err.description.includes("terminated by other getUpdates request")
  );
}
