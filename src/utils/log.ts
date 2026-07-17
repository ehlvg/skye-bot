import pino, { type Logger } from "pino";

const _p = pino({ level: "info" });

/**
 * Structured JSON logger (pino).
 * Accepts both plain strings and structured objects:
 *   log.info("Bot started")
 *   log.info({ chatId: 123, userId: 456 }, "Request received")
 *
 * In development, pipe output through pino-pretty for human-readable logs:
 *   bun run dev 2>&1 | bunx pino-pretty
 */
export const log: Logger = Object.assign(_p, {
  /** @deprecated alias for log.error() — kept for backward compatibility */
  err: _p.error.bind(_p),
});

/** Set the log level from config. Call once at startup before any logging. */
export function setLogLevel(level: string): void {
  _p.level = level;
}
