<div align="center"><img src="./assets/logo.png" alt="Cloud circle avatar" width="96"/></div>

<h3 align="center">
    Skye
</h1>

<p align="center">
    <sup>A calm, minimal-minded assistant that keeps things simple and clear.</sup>
</p>

<p align="center">
    <img src="https://img.shields.io/badge/pnpm-%234a4a4a.svg?style=for-the-badge&logo=pnpm&logoColor=f69220" alt="PNPM"/>
    <img src="https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/>
    <img src="https://img.shields.io/badge/node.js-6DA55F.svg?style=for-the-badge&logo=node.js&logoColor=white" alt="NodeJS"/>
    <img src="https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg?style=for-the-badge" alt="License: AGPL-3.0-only"/>
</p>

---

## Quick start

```bash
pnpm install
cp config.example.yaml config.yaml   # then fill in bot_token, openai_key, etc.
pnpm run dev          # or dev:pretty for human-readable logs
```

See `AGENTS.md` for the repository conventions.

## Documentation

Skye's full documentation lives in the [`docs/`](docs/) directory:

- **[Overview](docs/README.md)** — What Skye is, who it's for, and what it can do.
- **[Personality](docs/personality.md)** — How Skye thinks and communicates.
- **[Features](docs/features.md)** — All commands, interactions, and capabilities.
- **[Configuration](docs/configuration.md)** — Environment variables, API setup, and per-user settings.
- **[MCP Tools](docs/mcp-tools.md)** — Connecting external tools to Skye via Model Context Protocol.

## License

Copyright © 2026 Erich Helvig. Skye Bot is licensed under the [GNU Affero General Public License v3.0 only](LICENSE).

This is a strong copyleft license. Any derivative work — including network services built on top of Skye — must be distributed under the same license, with complete corresponding source code made available to all users.
