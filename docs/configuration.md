# Configuration

Skye is configured through a `config.yaml` file and per-user settings. This page covers both.

## Configuration file

Create a `config.yaml` from `config.example.yaml`. All keys are required unless marked optional.

Real environment variables override YAML values — useful for platform-injected secrets (e.g. `VERCEL_OIDC_TOKEN` on Vercel hosting) or PaaS dashboards that don't allow mounting config files. For local dev and VPS, put everything in `config.yaml`.

### Core

| Key                | Purpose                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| `bot_token`        | Your Telegram bot token from [@BotFather](https://t.me/botfather).                |
| `openai_key`       | API key for the LLM. Works with OpenRouter, OpenAI, or any compatible API.        |
| `model`            | LLM model ID. Default: `openai/gpt-oss-120b`.                                     |
| `base_url`         | API base URL. Default: `https://openrouter.ai/api/v1`.                            |
| `max_completion_tokens` | Maximum tokens per response. Default: `500`.                                      |
| `allowed_ids`      | Comma-separated Telegram chat IDs that can use the bot without their own API key. |
| `telegram_polling_lock` | Set to `"0"` to disable the single-instance polling lock. Default: `"1"`.       |
| `use_chat_completions` | Set to `true` if your provider doesn't support the Responses API. Default: `false`. |
| `log_level`        | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Default: `info`. |
| `db_path`          | SQLite database path. Default: `data/skye.db`. Supports `:memory:` for ephemeral storage. |

### Image generation

| Key                | Purpose                                                                               |
| ------------------ | ------------------------------------------------------------------------------------- |
| `image.base_url`   | Separate API base URL for image generation. Falls back to `base_url` if empty.        |
| `image.api_key`    | Separate API key for image generation. Falls back to `openai_key` if empty.          |
| `image.model`      | Model for image generation/editing. Default: `google/gemini-3.1-flash-image-preview`. |

These are useful if your chat provider doesn't support image generation (e.g., a local Ollama instance) and you want to use OpenRouter or another service just for images.

### Voice (speech — optional)

Skye supports two interchangeable speech providers — **Yandex SpeechKit** (default) and **OpenRouter**. Both cover speech-to-text (STT) and text-to-speech (TTS). Pick one with `voice.provider`:

| Key                     | Purpose                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `voice.provider`        | `yandex` (default) or `openrouter`.                                                              |
| `voice.yc_api_key`      | Yandex Cloud API key for speech recognition and synthesis.                                      |
| `voice.yc_folder_id`    | Yandex Cloud folder ID.                                                                          |
| `voice.tts_voice`       | Yandex TTS voice name. Default: `jane`.                                                          |
| `voice.tts_emotion`     | Yandex TTS emotion: `neutral`, `good`, `evil`, `strict`, or `friendly`.                          |
| `voice.tts_lang`        | Yandex TTS BCP-47 language tag. Default: `ru-RU`.                                                |
| `voice.tts_speed`       | Yandex TTS playback speed (0.1 – 3.0). Default: `1.0`.                                          |
| `voice.openrouter.api_key`   | OpenRouter API key. Falls back to `openai_key` when empty.                                |
| `voice.openrouter.base_url` | OpenRouter base URL. Default: `https://openrouter.ai/api/v1`.                              |
| `voice.openrouter.stt_model`  | OpenRouter STT model. Default: `nvidia/parakeet-tdt-0.6b-v3`.                              |
| `voice.openrouter.tts_model`  | OpenRouter TTS model. Default: `google/gemini-3.1-flash-tts-preview`.                       |
| `voice.openrouter.tts_voice`  | OpenRouter TTS voice id (model-specific). Default: `alloy`.                                  |
| `voice.openrouter.tts_format` | OpenRouter TTS response format: `mp3` (default) or `pcm`.                                    |
| `voice.openrouter.stt_format` | Format to normalize input audio into before STT: `mp3` (default), `wav`, or `oggopus`        |
| `voice.openrouter.stt_language` | ISO-639-1 language hint for STT (e.g. `ru`). Empty = auto-detect.                         |
| `voice.openrouter.referer`  | Optional `HTTP-Referer` header for OpenRouter rankings.                                       |
| `voice.openrouter.title`    | Optional `X-OpenRouter-Title` header.                                                          |

Voice features are **optional**. Leave the relevant keys empty to disable voice. Yandex TTS returns OGG Opus directly; OpenRouter TTS returns MP3/PCM which Skye transcodes to OGG Opus via the bundled `ffmpeg-static` binary so it can be sent as a Telegram voice note.

### Logging & audit

| Key                | Purpose                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ |
| `log_level`            | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Default: `info`. |
| `audit.retention_days` | Auto-delete audit logs older than N days. Default: `90`.                             |
| `audit.max_rows`       | Maximum audit log rows to keep. Default: `100000`.                                   |

### MCP

| Key                | Purpose                                             |
| ------------------ | --------------------------------------------------- |
| `mcp.config_path`  | Path to the MCP config file. Default: `./mcp.json`. |

See [MCP Tools](mcp-tools.md) for configuration details.

### Settings panel

| Key                | Purpose                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `panel.webapp_url`  | Public URL where the Telegram Mini App is accessible. Set this in BotFather too. |
| `panel.webapp_port` | Port for the panel web server. Default: `3001`.                                  |

### Vercel Sandbox

| Key                | Purpose                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `sandbox.enabled`  | Enable the Vercel Sandbox feature. Default: `true`.                                       |
| `sandbox.runtime`  | Sandbox runtime. Default: `node24`.                                                       |
| `sandbox.timeout_ms` | Sandbox VM timeout. Default: `300000`.                                                   |
| `sandbox.vcpus`    | Sandbox vCPUs. Default: `2`.                                                              |
| `sandbox.persistent` | Keep sandbox filesystem between sessions. Default: `false`.                              |
| `sandbox.command_timeout_ms` | Per-command timeout. Default: `60000`.                                           |
| `sandbox.vercel_access_token` | Vercel API token. Can be overridden by `VERCEL_OIDC_TOKEN` env var on Vercel.     |
| `sandbox.vercel_project_id`   | Vercel project ID.                                                                |
| `sandbox.vercel_team_id`      | Vercel team ID.                                                                   |

## Access control

Skye uses a layered access system:

1. **Allowlist**: Chat IDs in `allowed_ids` have unrestricted access.
2. **Per-chat key**: Chats can have their own API key set via the Settings panel.
3. **Per-user key**: Users can set their own API key, model, and prompt via the Settings panel.
4. **Global key**: The `openai_key` from `config.yaml` is used as a fallback.

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
3. Global `openai_key` (from `config.yaml`)

The first configured key wins. This means a user can override both the chat and global keys with their personal configuration.