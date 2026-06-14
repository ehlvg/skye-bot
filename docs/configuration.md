# Configuration

Skye is configured through environment variables and per-user settings. This page covers both.

## Environment variables

Create a `.env` file from `env.example`. All variables are required unless marked optional.

### Core

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Your Telegram bot token from [@BotFather](https://t.me/botfather). |
| `OPENAI_KEY` | API key for the LLM. Works with OpenRouter, OpenAI, or any compatible API. |
| `MODEL` | LLM model ID. Default: `openai/gpt-oss-120b`. |
| `BASE_URL` | API base URL. Default: `https://openrouter.ai/api/v1`. |
| `MAX_COMPLETION_TOKENS` | Maximum tokens per response. Default: `500`. |
| `ALLOWED_IDS` | Comma-separated Telegram chat IDs that can use the bot without their own API key. |

### Image generation

| Variable | Purpose |
|---|---|
| `IMAGE_BASE_URL` | Separate API base URL for image generation. Falls back to `BASE_URL` if empty. |
| `IMAGE_API_KEY` | Separate API key for image generation. Falls back to `OPENAI_KEY` if empty. |
| `IMAGE_MODEL` | Model for image generation/editing. Default: `google/gemini-3.1-flash-image-preview`. |

These are useful if your chat provider doesn't support image generation (e.g., a local Ollama instance) and you want to use OpenRouter or another service just for images.

### Voice (SpeechKit — optional)

| Variable | Purpose |
|---|---|
| `YC_API_KEY` | Yandex Cloud API key for speech recognition and synthesis. |
| `YC_FOLDER_ID` | Yandex Cloud folder ID. |
| `YC_TTS_VOICE` | TTS voice name. Default: `jane`. |
| `YC_TTS_EMOTION` | TTS emotion: `neutral`, `good`, `evil`, `strict`, or `friendly`. |
| `YC_TTS_LANG` | BCP-47 language tag. Default: `ru-RU`. |
| `YC_TTS_SPEED` | Playback speed (0.1 – 3.0). Default: `1.0`. |

Voice features are **optional**. If you don't need speech input/output, leave YC variables empty.

### Logging & audit

| Variable | Purpose |
|---|---|
| `LOG_LEVEL` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Default: `info`. |
| `AUDIT_RETENTION_DAYS` | Auto-delete audit logs older than N days. Default: `90`. |
| `AUDIT_MAX_ROWS` | Maximum audit log rows to keep. Default: `100000`. |

### MCP

| Variable | Purpose |
|---|---|
| `MCP_CONFIG_PATH` | Path to the MCP config file. Default: `./mcp.json`. |

See [MCP Tools](mcp-tools.md) for configuration details.

### Settings panel

| Variable | Purpose |
|---|---|
| `WEBAPP_URL` | Public URL where the Telegram Mini App is accessible. Set this in BotFather too. |
| `WEBAPP_PORT` | Port for the panel web server. Default: `3001`. |

### Database

| Variable | Purpose |
|---|---|
| `DB_PATH` | SQLite database path. Default: `data/skye.db`. Supports `:memory:` for ephemeral storage. |

## Access control

Skye uses a layered access system:

1. **Allowlist**: Chat IDs in `ALLOWED_IDS` have unrestricted access.
2. **Per-chat key**: Chats can have their own API key set via the Settings panel.
3. **Per-user key**: Users can set their own API key, model, and prompt via the Settings panel.
4. **Global key**: The `OPENAI_KEY` from `.env` is used as a fallback.

If none of these are configured for a user or chat, Skye asks them to set up an API key via `/config`.

## Per-user settings

Each user can customize the following through the Settings panel (accessible via `/config`):

- **API key** — Their own OpenAI-compatible key.
- **API base URL** — Their own API endpoint.
- **Model** — Which LLM to use for their conversations.
- **Max tokens** — Maximum response length.
- **System prompt** — Custom instructions appended to Skye's base personality. This doesn't replace Skye's core character — it adds additional guidance on top.

## Per-chat settings

Each chat can have its own:

- **API key** and **base URL** — For group-level billing or model selection.
- **Voice mode** — Toggled with `/voice`, persists per chat.

Settings are stored in SQLite and survive restarts.

## Credential precedence

When resolving which credentials to use, Skye checks in this order:

1. User's own API key (from Settings panel)
2. Chat's own API key
3. Global `OPENAI_KEY` (from `.env`)

The first configured key wins. This means a user can override both the chat and global keys with their personal configuration.
