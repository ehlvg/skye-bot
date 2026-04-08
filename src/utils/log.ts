import pino from "pino";

const _p = pino({ level: process.env.LOG_LEVEL ?? "info" });

/**
 * Structured JSON logger (pino).
 * Accepts both plain strings and structured objects:
 *   log.info("Bot started")
 *   log.info({ chatId: 123, userId: 456 }, "Request received")
 *
 * In development, pipe output through pino-pretty for human-readable logs:
 *   bun run dev 2>&1 | bunx pino-pretty
 */
export const log = Object.assign(_p, {
  /** @deprecated alias for log.error() — kept for backward compatibility */
  err: _p.error.bind(_p),
});
