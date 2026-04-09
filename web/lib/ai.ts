import OpenAI from "openai"
import { BASE_URL, MAX_COMPLETION_TOKENS, MODEL, OPENAI_KEY } from "./config"
import {
  addWebMemory,
  deleteWebMemory,
  getWebMemories,
  saveMessage,
} from "./db"

// ── System prompt ────────────────────────────────────────────────────────────

function buildSystemContent(): string {
  const memories = getWebMemories()
  const date = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  })

  let content = `You are **Skye**, a calm, minimal, and grounded AI assistant.

## Core Identity
- **Name**: Skye
- **Personality**: Calm, clear, warm, steady
- **Communication style**: Concise and minimal — say what matters, nothing more

## Communication Principles
- Keep responses short and direct
- Use simple, everyday language
- Maintain a warm, steady presence
- Avoid unnecessary elaboration or detail
- No artificial friendliness or corporate language

## Structure
- Default to short paragraphs or single sentences
- Use formatting (bold, lists, code blocks) when it genuinely aids clarity
- Let the content speak for itself

Today is ${date}.

## Memory

You have access to long-term memory tools. Use \`save_memory\` to remember important information when asked or when you encounter notable facts (names, preferences, project details). Use \`delete_memory\` with the memory ID to forget something when asked.`

  if (memories.length > 0) {
    content += "\n\nSaved memories:\n"
    for (const m of memories) {
      content += `- [${m.id}] ${m.content}\n`
    }
  }

  return content
}

// ── Memory tools ─────────────────────────────────────────────────────────────

const memoryTools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "save_memory",
      description:
        "Save a piece of information to long-term memory. Use when the user asks you to remember something, or when you encounter important facts.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description:
              "The information to remember, written as a clear factual statement.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_memory",
      description:
        "Delete a specific memory by its ID when the user asks to forget something.",
      parameters: {
        type: "object",
        properties: {
          memory_id: {
            type: "string",
            description: "The ID of the memory to delete (e.g. mem_abc123).",
          },
        },
        required: ["memory_id"],
      },
    },
  },
]

async function executeMemoryTool(
  name: string,
  args: Record<string, string>
): Promise<string> {
  if (name === "save_memory") {
    const entry = addWebMemory(args.content)
    return `Memory saved with ID ${entry.id}.`
  }
  if (name === "delete_memory") {
    const ok = deleteWebMemory(args.memory_id)
    return ok
      ? `Memory ${args.memory_id} deleted.`
      : `Memory ${args.memory_id} not found.`
  }
  return `Unknown tool: ${name}`
}

// ── Chat streaming ────────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "chunk"; content: string }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string }

type ApiMessage = OpenAI.Chat.ChatCompletionMessageParam

export async function* streamChat(
  threadId: string,
  history: {
    role: "user" | "assistant"
    content: string
    imageUrl?: string | null
  }[],
  userContent: string,
  userImageUrl?: string | null
): AsyncGenerator<StreamEvent> {
  const client = new OpenAI({ baseURL: BASE_URL, apiKey: OPENAI_KEY })

  // Build conversation history
  const historyMsgs: ApiMessage[] = history.map((m) => {
    if (m.imageUrl && m.role === "user") {
      return {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: m.imageUrl } },
          { type: "text", text: m.content },
        ],
      }
    }
    return { role: m.role, content: m.content }
  })

  // Current user message
  const userMsg: ApiMessage = userImageUrl
    ? {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: userImageUrl } },
          { type: "text", text: userContent },
        ],
      }
    : { role: "user", content: userContent }

  const msgs: ApiMessage[] = [
    { role: "system", content: buildSystemContent() },
    ...historyMsgs,
    userMsg,
  ]

  const MAX_ITER = 5

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const stream = client.chat.completions.stream({
      model: MODEL,
      messages: msgs,
      tools: memoryTools,
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    })

    let fullContent = ""
    const pending: Record<number, { id: string; name: string; args: string }> =
      {}
    let finishReason = ""

    for await (const chunk of stream) {
      const choice = chunk.choices[0]
      const delta = choice?.delta

      if (delta?.content) {
        fullContent += delta.content
        yield { type: "chunk", content: delta.content }
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!pending[tc.index]) {
            pending[tc.index] = {
              id: tc.id ?? "",
              name: tc.function?.name ?? "",
              args: "",
            }
          }
          if (tc.function?.name) pending[tc.index].name = tc.function.name
          if (tc.function?.arguments)
            pending[tc.index].args += tc.function.arguments
        }
      }

      if (choice?.finish_reason) finishReason = choice.finish_reason
    }

    // Finished generating text
    if (
      finishReason === "stop" ||
      finishReason === "end_turn" ||
      (fullContent && !finishReason)
    ) {
      const saved = saveMessage(threadId, "assistant", fullContent)
      yield { type: "done", messageId: saved.id }
      return
    }

    // Tool calls — execute them and loop
    if (finishReason === "tool_calls" || Object.keys(pending).length > 0) {
      const toolCalls = Object.values(pending)

      msgs.push({
        role: "assistant",
        content: fullContent || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      } as ApiMessage)

      for (const tc of toolCalls) {
        let parsedArgs: Record<string, string> = {}
        try {
          parsedArgs = JSON.parse(tc.args || "{}")
        } catch {}
        const result = await executeMemoryTool(tc.name, parsedArgs)
        msgs.push({ role: "tool", tool_call_id: tc.id, content: result })
      }

      continue // next iteration
    }

    // Unexpected finish
    if (fullContent) {
      const saved = saveMessage(threadId, "assistant", fullContent)
      yield { type: "done", messageId: saved.id }
      return
    }

    break
  }

  yield { type: "error", message: "Max iterations reached without a response." }
}

// ── Image generation ──────────────────────────────────────────────────────────

const IMAGE_MODEL = "google/gemini-3.1-flash-image-preview"

export async function generateImage(
  prompt: string,
  imageUrl?: string | null
): Promise<string> {
  const content: unknown = imageUrl
    ? [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ]
    : prompt

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      messages: [{ role: "user", content }],
      modalities: ["image", "text"],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Image generation failed (${res.status}): ${body}`)
  }

  const data: Record<string, unknown> = await res.json()
  const images = (data.choices as Array<Record<string, unknown>>)?.[0]
    ?.message as Record<string, unknown>
  const imageList = (images?.images as Array<Record<string, unknown>>) ?? []

  if (!imageList.length) throw new Error("No image was generated")

  return (imageList[0].image_url as { url: string }).url
}
