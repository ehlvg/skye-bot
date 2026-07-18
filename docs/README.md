# Skye Bot

Skye is a calm, minimal AI assistant for Telegram. It answers questions, remembers things, processes images, understands voice, and can connect to external tools — all while keeping its replies warm, clear, and to the point.

## Who is Skye for?

- **Individuals** who want a thoughtful assistant in their pocket, reachable from Telegram.
- **Groups** where Skye can listen, summarize, and help when addressed.
- **Developers** who want managed app integrations or a custom HTTPS connector.

## What Skye can do

| Capability              | How                                                                 |
| ----------------------- | ------------------------------------------------------------------- |
| **Chat**                | Streaming, context-aware conversations. Calm and concise by design. |
| **Remember**            | Long-term memory: saves and recalls facts across conversations.     |
| **Generate images**     | Creates images from text descriptions.                              |
| **Edit images**         | Send a photo with `/image <prompt>` to transform it.                |
| **See images**          | Send a photo with a question and Skye will describe or analyze it.  |
| **Listen to voice**     | Voice messages are transcribed and answered.                        |
| **Speak back**          | Toggle voice replies with `/voice`.                                 |
| **Use tools**           | Built-in tools plus private per-user app connectors.                |
| **Group summarization** | In groups, Skye summarizes older messages to stay aware of context. |
| **Per-user settings**   | Each user can bring their own API key, model, and custom prompt.    |

## Quick tour of this documentation

- **[Personality](personality.md)** — How Skye thinks and communicates.
- **[Features](features.md)** — All commands, interactions, and capabilities.
- **[Configuration](configuration.md)** — Environment variables, API setup, and per-user settings.
- **[Connectors](connectors.md)** — Managed OAuth apps and custom HTTPS endpoints.

## Getting started

1. Create a Telegram bot with [@BotFather](https://t.me/botfather).
2. Copy `config.example.yaml` to `config.yaml` and fill in your `bot_token` and `openai_key`.
3. Run `pnpm install && pnpm run dev`.
4. Open Telegram, find your bot, and say hello.
