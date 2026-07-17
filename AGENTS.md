# Repository Guidelines

This document captures how we work in this repo. It is intended for contributors and automation agents alike.

## Project Overview

Skye is a calm, minimal AI assistant for Telegram, built with [grammy](https://grammy.dev/) + an OpenAI-compatible LLM API (OpenRouter by default). It supports streaming chat, long-term memory, image generation/editing/vision, voice (Yandex SpeechKit STT/TTS), document reading, MCP tools, a per-chat Vercel Sandbox, and a Telegram Mini App settings panel. State lives in a single SQLite database (`better-sqlite3`).

## Architecture: The Module System

Everything is a `SkyeModule` (see `src/core/module.ts`). Modules are declared in a fixed-order array in `src/index.ts`; order matters because modules consume earlier ones' services (e.g. `llm` before `chatLog`, `userConfig` before `mcp`, `telegram` last).

Each module optionally provides:

- `configSchema`: Zod object for the module's YAML config section (native YAML keys, snake_case).
- `migrations[]`: Idempotent schema migrations keyed `${module.name}:${migration.id}`, tracked in a `migrations` table.
- `init(ctx)`: Returns `{ service, tools, commands, telegramHandlers, panelRoutes }`.
- `start(ctx, contributions, extra)`: Second phase; `telegram` and `panel` consume the aggregated bot/Express app.
- `shutdown()`: Cleanup in reverse order.

Config is loaded once from `config.yaml`, validated against the composed Zod schema, and passed as a typed `SkyeConfig` via `ctx.config`. No environment variables are involved (except `SKYE_CONFIG` to point at a non-default config path). Each module augments `SkyeConfig` via `declare module` to add its typed section.

New domains go in `src/modules/<name>/` exporting a `SkyeModule`, register their service type, and add themselves to the array in `src/index.ts`.

## Build, Test, and Development Commands

Package manager is **pnpm** (workspace includes `web/`). Node 22+.

- `pnpm run dev` / `pnpm run dev:pretty`: Run the bot with `tsx watch` (plain or pretty logs).
- `pnpm run build`: Compile to `dist/` via `tsc -p tsconfig.build.json`.
- `pnpm run typecheck`: Type-check only.
- `pnpm run lint` / `pnpm run lint:fix`: ESLint flat config.
- `pnpm run format` / `pnpm run format:check`: Prettier.
- `pnpm run test` / `pnpm run test:watch`: Vitest.
- `pnpm --filter skye-panel build`: Build the web panel only.
- `pnpm validate-config`: Validate `config.yaml` against the composed module config schemas (run before booting if you changed config).
- `pnpm config:schema`: Regenerate `docs/configuration-schema.md` from the module Zod schemas (run after adding/changing a module's `configSchema`).

Local dev runs TypeScript directly via `tsx`; production runs `node dist/index.js`.

## Testing Guidelines

Tests use **Vitest** (`vitest.config.ts`) with in-memory SQLite (`DB_PATH=:memory:`) and a setup file that resets the DB singleton. Test files live in `src/**/__tests__/`. Mirror existing patterns (service-level integration tests backed by the real SQLite DB), keep them deterministic and side-effect-free.

## Coding Style & Naming Conventions

- Language: TypeScript (ESM, `"type": "module"`), `strict` mode, `moduleResolution: Bundler`, target `ES2022`.
- Imports use explicit `.js` extensions in relative paths (required by ESM + tsx), e.g. `import { log } from "../../utils/log.js"`.
- Indentation: 2 spaces. Formatting: Prettier. Linting: ESLint with `typescript-eslint`; `@typescript-eslint/no-explicit-any` is a warning, not an error.
- File naming: lower camelCase for modules.
- Keep functions small and focused; prefer clear names over comments. Do not add comments unless asked.

## Commit & Pull Request Guidelines

This repo uses **git** with a standard PR flow. Recent commit history uses short, imperative messages (e.g. "Add long-term memory", "Fix image processing issue"). Please follow that style.

For pull requests:

- Include a concise summary and a short testing note (e.g. "Tested: `pnpm run dev`").
- Link related issues when applicable.
- Include screenshots only if UI output changes.

Run `pnpm run typecheck`, `pnpm run lint`, and `pnpm run test` before submitting; fix anything you broke.

## Configuration & Secrets

Create a `config.yaml` based on `config.example.yaml`. Required: `bot_token`, `openai_key`. Everything else has sensible defaults (OpenRouter). Never commit real secrets (`config.yaml` is gitignored). Full variable reference lives in `config.example.yaml`, `docs/configuration.md`, and the auto-generated `docs/configuration-schema.md` (regenerate with `pnpm config:schema`). Validate before booting with `pnpm validate-config`.

Credential precedence for LLM calls: per-user key → per-chat key → global `openai_key`.

## Useful Pointers

- Personality/system prompt: `src/modules/llm/prompt.ts`.
- Telegram access control: `src/modules/telegram/access.ts`.
- Panel auth: `src/modules/panel/auth.ts`.
- MCP server config: `mcp.json` + `src/modules/mcp/service.ts`.
- User-facing docs: `docs/`.