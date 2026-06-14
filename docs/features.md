# Features

Skye supports several interaction modes and commands. This page covers what you can do and how.

## Commands

| Command | What it does | Public? |
|---|---|---|
| `/reset` | Clears the current conversation context. Skye forgets the last few messages (but not long-term memories). | Yes |
| `/config` | Opens the Settings panel where you can set your API key, model, and other preferences. | Yes |
| `/image <prompt>` | Generates an image from your description. Example: `/image a cat on the moon`. | No |
| `/voice` | Toggles voice reply mode on/off. When on, Skye speaks its responses as voice notes. | Yes |
| `/forget` | Clears all long-term memories for the current chat. Conversation history is not affected. | No |

## Interactions

### Text chat

Send a message. In private chats, Skye responds automatically. In groups, mention Skye by its username (e.g., `@skye_bot`) to get a reply.

Conversations are **streaming** — you'll see Skye's response build in real time as a draft, then finalize when complete. The bot remembers the last 30 messages per thread to maintain context. Use `/reset` to clear this buffer.

### Image generation

Send `/image <prompt>` and Skye generates an image using the configured image model. The default model is Google's Gemini image model through OpenRouter, but you can [change this in configuration](configuration.md#image-generation).

### Image editing

Send a photo to Skye with a caption that starts with `/image <prompt>`. Skye takes your photo and applies the edits you describe. For example: send a photo of a landscape with the caption `/image make it look like a watercolor painting`.

### Vision (image understanding)

Send a photo with any caption or question. Skye will analyze the image and respond. This works with any vision-capable LLM. If the model doesn't support images, Skye will let you know.

### Voice input

Send a voice message. Skye transcribes it using Yandex Cloud SpeechKit and responds as if you'd typed the message. This requires Yandex Cloud configuration — see [Configuration](configuration.md#voice-speechkit).

### Voice output

Toggle voice replies with `/voice`. When active, Skye synthesizes its text responses into voice notes using Yandex TTS. The voice, language, and emotion are configurable.

## Long-term memory

Skye can remember things across conversations. Two built-in tools are available to the LLM:

- **`save_memory`** — Stores a fact, preference, or note. Skye uses this automatically when you tell it something worth remembering, or you can ask it directly: "Remember that my favorite color is blue."
- **`delete_memory`** — Removes a specific memory by its ID.

Memories are stored per chat in the database and are injected into every conversation. Use `/forget` to wipe all memories for the current chat. You can also view and delete individual memories from the Settings panel.

## Group chat features

In groups, Skye:

- **Listens** for mentions and commands addressed to it.
- **Logs** recent messages (last 50) per group.
- **Summarizes** older messages every 10 new messages, using an LLM call to create a compact summary. Both the recent log and the summary are included in the system prompt so Skye stays aware of the conversation.

## MCP tools

Skye supports the [Model Context Protocol](mcp-tools.md) to connect external tools. Tools from MCP servers are exposed to the LLM as function calls. Skye can execute them during a conversation — for example, querying a database, checking a service status, or interacting with an API.

## Streaming drafts

While Skye is thinking, you'll see a live-updating draft message. Tool calls are shown with indicators (🧠 for built-in tools, 🔌 for MCP tools) so you can follow what Skye is doing before the final response arrives.

## Rate limiting

There's a 2-second cooldown between responses per thread. If you send messages too quickly, Skye may skip them. This prevents spam and API overuse.
