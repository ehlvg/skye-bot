# Configuration

Skye is configured through a `config.yaml` file and per-user settings. This page covers both.

## Configuration file

Create a `config.yaml` from `config.example.yaml`. All keys are required unless marked optional.

Real environment variables override YAML values — useful for platform-injected secrets (e.g. `VERCEL_OIDC_TOKEN` on Vercel hosting) or PaaS dashboards that don't allow mounting config files. For local dev and VPS, put everything in `config.yaml`.

### Core

| Key                | Purpose                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| `bot_token`        | Your Telegram bot token from [@BotFather](https://t.me/botfather).                |
| `openai_key`       | API key for the LLM provider (the bot's own key — users no longer bring their own). |
| `base_url`         | API base URL. Default: `https://openrouter.ai/api/v1`.                            |
| `max_completion_tokens` | Maximum tokens per response. Default: `500`.                                      |
| `admin_ids`        | Comma-separated Telegram **user** IDs that administer the bot (free, unlimited access + `/allow`/`/ban` commands). |
| `allowed_ids`      | _(Legacy)_ Comma-separated chat/user IDs. Seeded into the allowlist once on upgrade; afterwards manage access with `/allow`. |
| `telegram_polling_lock` | Set to `"0"` to disable the single-instance polling lock. Default: `"1"`.       |
| `owner.name`       | Bot owner/author display name. Surfaced in the system prompt so Skye weights their messages above others. |
| `owner.tag`        | Bot owner's Telegram username (without `@`). Paired with `owner.name`. |
| `use_chat_completions` | Set to `true` if your provider doesn't support the Responses API. Default: `false`. |
| `log_level`        | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Default: `info`. |
| `db_path`          | SQLite database path. Default: `data/skye.db`. Supports `:memory:` for ephemeral storage. |

### Models (masked catalog)

Users pick from masked model tiers; the real provider model IDs and token multipliers are configured by the operator and never shown to end users.

| Key                | Purpose                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `default_model_id` | Masked id new subscribers start on (e.g. `sydney`).                                            |
| `models[].id`      | Internal id, must match what `/models` and the panel reference.                               |
| `models[].name`    | Display name (e.g. `Sydney`, `Tokyo`, `Berlin`, `Toronto`).                                   |
| `models[].model`   | Real provider model id used for the upstream call (e.g. `openai/gpt-5.5`).                     |
| `models[].multiplier` | Token cost multiplier applied to usage (e.g. `1.0`, `1.5`, `2.5`, `4.0`).                   |

### Skye Plus subscription (Telegram Stars)

Public users unlock Skye with a recurring Stars subscription and top up with one-off token packs.

| Key                | Purpose                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `billing.currency` | Telegram Stars currency; always `XTR`.                                                        |
| `billing.title` | Invoice/title name shown to users. Default: `Skye Plus`.                                     |
| `billing.description` | Invoice description.                                                                         |
| `billing.subscription_stars` | Price per period in Stars. Default: `1899`.                                          |
| `billing.subscription_period_seconds` | Recurring period. Bot API 8.0 requires `2592000` (30 days). Default: `2592000`. |
| `billing.base_quota_tokens` | Tokens granted each renewal. Default: `2000000`.                                         |
| `billing.packs[]` | One-off token packs. Each has `id`, `name`, `stars`, and `tokens`.                           |

Packs are spent before the base quota and **expire when the subscription lapses**; they can only be bought while subscribed.

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

Skye is now SaaS-first. Who can use the bot is decided in this order:

1. **Admins** — IDs in `admin_ids`. Free, unlimited access; can run `/allow`, `/disallow`, `/ban`, `/unban`, `/allowed`.
2. **Allowlist** — chats/users an admin has allowlisted with `/allow` (or seeded from the legacy `allowed_ids`). Free, unlimited access.
3. **Banned** — explicitly blocked; takes precedence over everything else.
4. **Skye Plus subscription** — any other user with an active 1899 ⭐ / 30-day subscription (paid with Telegram Stars). Usage is metered against their token quota.

If none apply, Skye points the user to `/plus` to subscribe.

## Per-user settings

Each user can customize the following through the Settings panel (accessible via `/config`):

- **System prompt** — Custom instructions appended to Skye's base personality. This doesn't replace Skye's core character — it adds additional guidance on top.
- **Model tier** — Which masked model (Sydney/Tokyo/Berlin/Toronto) to use. Tier choice affects token cost via the configured multiplier.
- **Skye Plus** — Manage the subscription, view token balance, buy token packs, and cancel. Also reachable via `/plus`, `/models`, `/tokens`, `/cancel`.

## Per-chat settings

Each chat can have its own:

- **Voice mode** — Toggled with `/voice`, persists per chat.

Settings are stored in SQLite and survive restarts.