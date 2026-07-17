# Configuration

Skye is configured through a `config.yaml` file and per-user settings. This page covers both.

## Configuration file

Create a `config.yaml` from `config.example.yaml`. All keys are required unless marked optional.

Real environment variables override YAML values — useful for platform-injected secrets (e.g. `DAYTONA_API_KEY`) or PaaS dashboards that don't allow mounting config files. For local dev and VPS, put everything in `config.yaml`.

### Core

| Key                             | Purpose                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `bot_token`                     | Your Telegram bot token from [@BotFather](https://t.me/botfather).                                                           |
| `openai_key`                    | API key for the LLM provider (the bot's own key — users no longer bring their own).                                          |
| `base_url`                      | API base URL. Default: `https://openrouter.ai/api/v1`.                                                                       |
| `max_completion_tokens`         | Maximum tokens per response. Default: `500`.                                                                                 |
| `admin_ids`                     | Comma-separated Telegram **user** IDs that administer the bot (free, unlimited access + `/allow`/`/ban` commands).           |
| `allowed_ids`                   | _(Legacy)_ Comma-separated chat/user IDs. Seeded into the allowlist once on upgrade; afterwards manage access with `/allow`. |
| `telegram_polling_lock`         | Set to `"0"` to disable the single-instance polling lock. Default: `"1"`.                                                    |
| `telegram_drop_pending_updates` | Set to `"1"` only for an intentional one-time backlog reset. Default: `"0"`, so updates received during downtime are kept.   |
| `telegram_job_timeout_ms`       | Maximum processing time for one queued chat job. Default: `180000` (3 minutes).                                              |
| `telegram_max_attachment_bytes` | Maximum Telegram file/image download size. Default: `26214400` (25 MiB).                                                     |
| `owner.name`                    | Bot owner/author display name. Surfaced in the system prompt so Skye weights their messages above others.                    |
| `owner.tag`                     | Bot owner's Telegram username (without `@`). Paired with `owner.name`.                                                       |
| `use_chat_completions`          | Set to `true` if your provider doesn't support the Responses API. Default: `false`.                                          |
| `log_level`                     | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Default: `info`.                                         |
| `db_path`                       | SQLite database path. Default: `data/skye.db`. Supports `:memory:` for ephemeral storage.                                    |

### Health checks and diagnostics

The panel server exposes lightweight operational probes:

- `GET /health/live` (and the legacy alias `GET /healthz`) reports whether the process is running.
- `GET /health/ready` reports HTTP `200` only after SQLite, Telegram polling, the LLM preflight, and the enabled reminder scheduler are ready. It returns `503` with per-component checks while startup is incomplete or a required component is unavailable.

Bot administrators can also use `/diagnostics` in Telegram to inspect update counters, duplicate suppression, queue depth, active-job age, timeouts, and cancellations. These counters cover the current process lifetime; completed Telegram update IDs are retained in SQLite to prevent duplicate handling after a restart.

### Models (masked catalog)

Users pick from masked model tiers; the real provider model IDs and token multipliers are configured by the operator and never shown to end users.

| Key                   | Purpose                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `default_model_id`    | Masked id new subscribers start on (e.g. `sydney`).                        |
| `models[].id`         | Internal id, must match what `/models` and the panel reference.            |
| `models[].name`       | Display name (e.g. `Sydney`, `Tokyo`, `Berlin`, `Toronto`).                |
| `models[].model`      | Real provider model id used for the upstream call (e.g. `openai/gpt-5.5`). |
| `models[].multiplier` | Token cost multiplier applied to usage (e.g. `1.0`, `1.5`, `2.5`, `4.0`).  |

### Skye Plus subscription (Telegram Stars)

Public users unlock Skye with a recurring Stars subscription and top up with one-off token packs.

| Key                                   | Purpose                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `billing.currency`                    | Telegram Stars currency; always `XTR`.                                          |
| `billing.title`                       | Invoice/title name shown to users. Default: `Skye Plus`.                        |
| `billing.description`                 | Invoice description.                                                            |
| `billing.subscription_stars`          | Price per period in Stars. Default: `1899`.                                     |
| `billing.subscription_period_seconds` | Recurring period. Bot API 8.0 requires `2592000` (30 days). Default: `2592000`. |
| `billing.base_quota_tokens`           | Tokens granted each renewal. Default: `2000000`.                                |
| `billing.packs[]`                     | One-off token packs. Each has `id`, `name`, `stars`, and `tokens`.              |

Packs are spent before the base quota and **expire when the subscription lapses**; they can only be bought while subscribed.

### Image generation

| Key              | Purpose                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `image.base_url` | Separate API base URL for image generation. Falls back to `base_url` if empty.        |
| `image.api_key`  | Separate API key for image generation. Falls back to `openai_key` if empty.           |
| `image.model`    | Model for image generation/editing. Default: `google/gemini-3.1-flash-image-preview`. |

These are useful if your chat provider doesn't support image generation (e.g., a local Ollama instance) and you want to use OpenRouter or another service just for images.

### Voice (speech — optional)

Skye supports two interchangeable speech providers — **Yandex SpeechKit** (default) and **OpenRouter**. Both cover speech-to-text (STT) and text-to-speech (TTS). Pick one with `voice.provider`:

| Key                             | Purpose                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `voice.provider`                | `yandex` (default) or `openrouter`.                                                   |
| `voice.yc_api_key`              | Yandex Cloud API key for speech recognition and synthesis.                            |
| `voice.yc_folder_id`            | Yandex Cloud folder ID.                                                               |
| `voice.tts_voice`               | Yandex TTS voice name. Default: `jane`.                                               |
| `voice.tts_emotion`             | Yandex TTS emotion: `neutral`, `good`, `evil`, `strict`, or `friendly`.               |
| `voice.tts_lang`                | Yandex TTS BCP-47 language tag. Default: `ru-RU`.                                     |
| `voice.tts_speed`               | Yandex TTS playback speed (0.1 – 3.0). Default: `1.0`.                                |
| `voice.openrouter.api_key`      | OpenRouter API key. Falls back to `openai_key` when empty.                            |
| `voice.openrouter.base_url`     | OpenRouter base URL. Default: `https://openrouter.ai/api/v1`.                         |
| `voice.openrouter.stt_model`    | OpenRouter STT model. Default: `nvidia/parakeet-tdt-0.6b-v3`.                         |
| `voice.openrouter.tts_model`    | OpenRouter TTS model. Default: `google/gemini-3.1-flash-tts-preview`.                 |
| `voice.openrouter.tts_voice`    | OpenRouter TTS voice id (model-specific). Default: `alloy`.                           |
| `voice.openrouter.tts_format`   | OpenRouter TTS response format: `mp3` (default) or `pcm`.                             |
| `voice.openrouter.stt_format`   | Format to normalize input audio into before STT: `mp3` (default), `wav`, or `oggopus` |
| `voice.openrouter.stt_language` | ISO-639-1 language hint for STT (e.g. `ru`). Empty = auto-detect.                     |
| `voice.openrouter.referer`      | Optional `HTTP-Referer` header for OpenRouter rankings.                               |
| `voice.openrouter.title`        | Optional `X-OpenRouter-Title` header.                                                 |

Voice features are **optional**. Leave the relevant keys empty to disable voice. Yandex TTS returns OGG Opus directly; OpenRouter TTS returns MP3/PCM which Skye transcodes to OGG Opus via the bundled `ffmpeg-static` binary so it can be sent as a Telegram voice note.

### Logging & audit

| Key                    | Purpose                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `log_level`            | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Default: `info`. |
| `audit.retention_days` | Auto-delete audit logs older than N days. Default: `90`.                             |
| `audit.max_rows`       | Maximum audit log rows to keep. Default: `100000`.                                   |

### Background jobs

Long-running asynchronous work is stored in SQLite before execution. The first
consumer is reminder delivery: a restart no longer loses the handoff between
the reminder scheduler and Telegram.

| Key                                | Purpose                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `background_jobs.enabled`          | Run the background worker. Default: `true`.                                     |
| `background_jobs.poll_interval_ms` | How often to poll for due work (100–60000 ms). Default: `1000`.                 |
| `background_jobs.lease_sec`        | Time after which an interrupted `running` job may be reclaimed. Default: `300`. |
| `background_jobs.retention_days`   | Retain successful and cancelled job records for diagnostics. Default: `7`.      |

Failed jobs use bounded exponential backoff and stop after their configured
attempt limit. Their error and attempt count remain in `background_jobs` for
diagnostics; `BackgroundJobsService.retry()` can explicitly requeue one.

### MCP

| Key               | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `mcp.config_path` | Path to the MCP config file. Default: `./mcp.json`. |

See [MCP Tools](mcp-tools.md) for configuration details.

### Settings panel

| Key                 | Purpose                                                                          |
| ------------------- | -------------------------------------------------------------------------------- |
| `panel.webapp_url`  | Public URL where the Telegram Mini App is accessible. Set this in BotFather too. |
| `panel.webapp_port` | Port for the panel web server. Default: `3001`.                                  |

### Legal

Surfaced via the `/terms`, `/privacy`, `/paysupport`, `/developer_info`, and `/delete_my_data` commands. Override to point at your own hosted documents and support contacts.

| Key                      | Purpose                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `legal.terms_url`        | Public Terms of Service URL opened by /terms. Default: Skye project ToS.              |
| `legal.privacy_url`      | Public Privacy Policy URL opened by /privacy. Default: Skye project privacy policy.   |
| `legal.support_username` | Telegram handle shown by /paysupport and /developer_info. Default: `@overwaven`.      |
| `legal.developer_name`   | Developer name shown by /developer_info. Default: `Sergey Gamuylo`.                   |
| `legal.developer_email`  | Contact email shown by /paysupport and /developer_info. Default: `serg@skye-bot.com`. |

### Daytona Sandbox

| Key                                       | Purpose                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `sandbox.enabled`                         | Enable the Daytona Sandbox feature. Default: `true`.                                                     |
| `sandbox.image`                           | Docker image used when no snapshot is configured. Default: `node:24-bookworm`.                           |
| `sandbox.snapshot`                        | Optional Daytona snapshot; takes precedence over `image`.                                                |
| `sandbox.cpu` / `memory_gib` / `disk_gib` | Resources for image-based sandboxes. Defaults: `1` CPU, `1` GiB RAM, `3` GiB disk.                       |
| `sandbox.auto_stop_minutes`               | Stop a sandbox after this period of inactivity. Default: `15`; `0` disables auto-stop.                   |
| `sandbox.auto_archive_minutes`            | Archive a stopped persistent sandbox after this period. Default: `10080` (7 days).                       |
| `sandbox.persistent`                      | Keep the sandbox filesystem after it stops. Default: `false`; ephemeral sandboxes delete after stopping. |
| `sandbox.command_timeout_ms`              | Per-command timeout. Default: `60000`.                                                                   |
| `sandbox.max_output_chars`                | Maximum command output returned. Default: `64000`.                                                       |
| `sandbox.max_file_bytes`                  | Maximum file size accepted by sandbox read/write. Default: `1000000`.                                    |
| `sandbox.daytona_api_key`                 | Daytona API key. Can also be set as `DAYTONA_API_KEY`.                                                   |
| `sandbox.daytona_api_url` / `target`      | Optional Daytona API endpoint and target region.                                                         |

Skye does not send Daytona network restriction parameters. The sandbox uses the organization's default
tier-based policy, including the essential-service allowlist on Tier 1 and Tier 2.

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
