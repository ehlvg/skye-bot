# Features

Skye supports several interaction modes and commands. This page covers what you can do and how.

## Commands

| Command           | What it does                                                                                              | Public? |
| ----------------- | --------------------------------------------------------------------------------------------------------- | ------- |
| `/reset`          | Clears the current conversation context. Skye forgets the last few messages (but not long-term memories). | Yes     |
| `/config`         | Opens the Settings panel where you can set your API key, model, and other preferences.                    | Yes     |
| `/image <prompt>` | Generates an image from your description. Example: `/image a cat on the moon`.                            | No      |
| `/voice`          | Toggles voice reply mode on/off. When on, Skye speaks its responses as voice notes.                       | Yes     |
| `/forget`         | Clears all long-term memories for the current chat. Conversation history is not affected.                 | No      |
| `/memories`       | Lists active memories with their category and expiration information.                                     | No      |
| `/status`         | Shows current model, vision, voice, memory, context, and MCP capability status.                           | Yes     |
| `/catchup`        | Summarizes the current group context from the rolling chat summary and recent log.                        | Yes     |
| `/terms`          | Opens the Terms of Service.                                                                               | Yes     |
| `/privacy`        | Opens the Privacy Policy.                                                                                 | Yes     |
| `/paysupport`     | Shows payment support contact details (Telegram + email).                                                 | Yes     |
| `/developer_info` | Shows the developer's name and contact details.                                                           | Yes     |
| `/delete_my_data` | Permanently erases all data Skye stores about you (private chats only, with confirmation).                | Yes     |

## Interactions

### Text chat

Send a message. In private chats, Skye responds automatically. In groups, mention Skye by its username (e.g., `@skye_bot`) to get a reply.

Conversations are **streaming** — you'll see Skye's response build in real time as a draft, then finalize when complete. Short bursts of Telegram messages are grouped into one request, and each thread has a serialized queue so messages are not silently dropped. Recent conversation context is stored per thread and restored after restarts. Use `/reset` to clear this buffer.

### Image generation

Send `/image <prompt>` and Skye generates an image using the configured image model. The default model is Google's Gemini image model through OpenRouter, but you can [change this in configuration](configuration.md#image-generation).

Generated images include compact controls:

- **Variation** — create a polished alternate version.
- **Prompt+** — rewrite the prompt into a stronger reusable prompt.
- **Square** — regenerate as a 1:1 composition.
- **Wide** — regenerate as a 16:9 composition.

### Image editing

Send a photo to Skye with a caption that starts with `/image <prompt>`. Skye takes your photo and applies the edits you describe. For example: send a photo of a landscape with the caption `/image make it look like a watercolor painting`.

### Vision (image understanding)

Send a photo with any caption or question. Skye will analyze the image and respond. This works with any vision-capable LLM. If the model doesn't support images, Skye will let you know.

### Voice input

Send a voice message. Skye transcribes it with the configured speech provider (Yandex SpeechKit or OpenRouter) and responds as if you'd typed the message. This requires voice configuration — see [Configuration](configuration.md#voice-speech-optional).

### Documents, PDFs and audio

Send text/code documents such as `.txt`, `.md`, `.json`, `.csv`, source files, logs, YAML, SQL, HTML, or XML. Skye reads the document content and answers using it as context.

Send a PDF and Skye parses it — text, images, tables, and layout — using the configured PDF parsing engine (Mistral OCR, Cloudflare AI, or native model support). The model sees the full content including embedded images.

**Reply to any message with media** — if someone sends a PDF, photo, or audio message in the chat, you can reply to it and ask Skye about it. Skye automatically collects the media from the replied message (images, PDFs, audio transcripts) and attaches them to your question, so the model can reason about the content even if it was sent by a different user.

Audio files and video notes are also transcribed through the configured speech provider. Skye normalizes audio formats with the bundled `ffmpeg` binary, so most audio/video formats are recognized without manual transcoding. Voice notes remain the most reliable format.

### Checklists

When you ask for a checklist, todo list, plan, or steps, Skye prefers Markdown task lists. If Telegram exposes a business connection that allows native checklists, Skye sends a native Telegram checklist; otherwise the rich Markdown task list is used as the fallback.

### Voice output

Toggle voice replies with `/voice`. When active, Skye synthesizes its text responses into voice notes using the configured TTS provider. With Yandex SpeechKit the voice, language, emotion, and speed are configurable; with OpenRouter the model and voice id are configurable. Output is sent as a Telegram voice note.

## Long-term memory

Skye can remember things across conversations. Memory is scoped to a chat and uses four categories:

- `preference` — stable user preferences; no automatic expiration.
- `fact` — stable facts; no automatic expiration.
- `task` — short-lived tasks; expires after 30 days by default.
- `project` — project context; expires after 180 days by default.

The memory service searches relevant records for the current request and sends only those results to the model. The model can also call `search_memory` explicitly. Expired records are archived automatically when the chat uses memory, and are excluded from normal lists and searches.

Up to four recent preferences are always included in the model context even when the current request uses different words. This keeps stable instructions such as language or answer-style preferences effective without loading the complete memory table.

When a new memory is sufficiently similar to an existing active memory in the same category, Skye updates the existing record instead of creating a duplicate.

Four built-in tools are available to the LLM:

- **`save_memory`** — Stores a fact, preference, or note. Skye uses this automatically when you tell it something worth remembering, or you can ask it directly: "Remember that my favorite color is blue."
- **`search_memory`** — Searches relevant memories by keywords and can filter by category.
- **`update_memory`** — Corrects the content, category, or expiration of an existing memory by ID.
- **`delete_memory`** — Removes a specific memory by its ID.

Memories are stored per chat. Use `/forget` to wipe all memories for the current chat. You can view, delete, and import/export memories from the Settings panel. Imports are limited to authorized chats and pass through the same validation and duplicate-merging rules as normal saves.

## Reminders

Ask Skye in natural language to create a one-time or repeating reminder. Use `/reminders` to view the numbered active reminders in the current chat with explicit UTC times. The list stays compact even when a chat has many reminders and does not add inline buttons.

Use `/postpone <number> <duration>` to move a reminder (`/postpone 1 35m`, `/postpone 2 2h`) and `/delete_reminder <number>` to delete one. Durations support minutes (`m`), hours (`h`), days (`d`), and weeks (`w`), up to 365 days. Commands are scoped to the current chat. When a reminder has an owner, only its creator can change it; older ownerless reminders remain manageable by members of their chat for backward compatibility.

## Group chat features

In groups, Skye:

- **Listens** for mentions and commands addressed to it.
- **Logs** recent messages (last 50) per group.
- **Summarizes** older messages every 10 new messages, using an LLM call to maintain a compact rolling summary with participants, topics, decisions, open questions, shared files/media, and timeline.
- Supports `/catchup` for a quick summary of what happened recently.

## MCP tools

Skye supports the [Model Context Protocol](mcp-tools.md) to connect external tools. Tools from MCP servers are exposed to the LLM as function calls. Skye can execute them during a conversation — for example, querying a database, checking a service status, or interacting with an API.

## Streaming drafts

While Skye is thinking, you'll see a live-updating draft message. Tool calls are shown with indicators (🧠 for built-in tools, 🔌 for MCP tools) so you can follow what Skye is doing before the final response arrives.

## Rate limiting

Requests are queued per thread. Short text bursts are grouped before Skye responds, which prevents accidental message drops while still keeping API usage controlled.
