import OpenAI from "openai";
import type {
  ResponseInputItem,
  ResponseFunctionToolCall,
} from "openai/resources/responses/responses.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { log } from "../../utils/log.js";

export interface ApiCredentials {
  apiKey: string;
  baseUrl: string;
  model?: string;
}

export type { ResponseInputItem, ResponseFunctionToolCall };

export interface LlmModuleSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxCompletionTokens: number;
  /** True → use Chat Completions API instead of Responses API. */
  useChatCompletions: boolean;
  /** Empty → falls back to apiKey. */
  imageApiKey: string;
  /** Empty → falls back to baseUrl. */
  imageBaseUrl: string;
  imageModel: string;
}

/** Response shape compatible with both APIs. */
export interface LlmResponse {
  output_text: string;
  output: Array<{
    type: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    [key: string]: unknown;
  }>;
}

/** Minimal streaming interface used by the chat loop. */
export interface LlmStream {
  on(event: "response.output_text.delta", cb: (data: { snapshot: string }) => void): void;
  finalResponse(): Promise<LlmResponse>;
}

// ---------------------------------------------------------------------------
// Chat Completions adapter — mimics the Responses API streaming interface
// ---------------------------------------------------------------------------

interface EmittedFnCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
  [key: string]: unknown;
}

class ChatCompletionsStreamAdapter {
  private listeners = new Map<string, ((data: unknown) => void)[]>();
  private responsePromise: Promise<LlmResponse>;
  private resolveResponse!: (value: LlmResponse) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private streamPromise: Promise<any>;

  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamPromise: Promise<any>
  ) {
    this.responsePromise = new Promise((r) => {
      this.resolveResponse = r;
    });
    this.streamPromise = streamPromise;
    this.process();
  }

  on(event: string, cb: (data: unknown) => void): void {
    const cbs = this.listeners.get(event) ?? [];
    cbs.push(cb as (data: unknown) => void);
    this.listeners.set(event, cbs);
  }

  private emit(event: string, data: unknown) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  private async process() {
    let text = "";
    const tcMap = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      // Await the underlying SDK stream (Promise<Stream<ChatCompletionChunk>>)
      const stream = (await this
        .streamPromise) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          text += delta.content;
          this.emit("response.output_text.delta", { snapshot: text });
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (!tcMap.has(idx)) {
              tcMap.set(idx, { id: "", name: "", arguments: "" });
            }
            const acc = tcMap.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.arguments += tc.function.arguments;
          }
        }
      }
    } catch (e) {
      log.warn(`Chat completions stream error: ${String(e)}`);
    }

    const output: EmittedFnCall[] = [];
    for (const [, tc] of tcMap) {
      if (tc.name) {
        output.push({
          type: "function_call",
          call_id: tc.id || crypto.randomUUID(),
          name: tc.name,
          arguments: tc.arguments,
        });
      }
    }

    this.resolveResponse({ output, output_text: text });
  }

  async finalResponse(): Promise<LlmResponse> {
    return this.responsePromise;
  }

  /** Expose underlying stream for abort / teardown if needed. */
  async abort() {
    try {
      const s = await this.streamPromise;
      s?.controller?.abort?.();
    } catch {
      // ignore
    }
  }
}

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/** Convert Responses API content parts to Chat Completions content. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertContent(content: any): any {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;
  return content.map((part: { type: string; text?: string; image_url?: string }) => {
    if (part.type === "input_text") return { type: "text", text: part.text };
    if (part.type === "input_image" && part.image_url) {
      return { type: "image_url", image_url: { url: part.image_url } };
    }
    return part;
  });
}

/** Convert ResponseInputItem[] + instructions → ChatCompletionMessageParam[]. */
function toChatMessages(
  input: ResponseInputItem[],
  instructions: string
): ChatCompletionMessageParam[] {
  const messages: ChatCompletionMessageParam[] = [];

  if (instructions) {
    messages.push({ role: "system", content: instructions });
  }

  let i = 0;
  while (i < input.length) {
    const item = input[i] as {
      type: string;
      role?: string;
      content?: unknown;
      call_id?: string;
      name?: string;
      arguments?: string;
      output?: string;
    };

    if (item.type === "message") {
      const role = (item.role ?? "user") as "user" | "assistant" | "system" | "developer";
      messages.push({ role, content: convertContent(item.content) });
      i++;
    } else if (item.type === "function_call") {
      const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = [];
      while (i < input.length) {
        const fc = input[i] as {
          type: string;
          call_id?: string;
          name?: string;
          arguments?: string;
        };
        if (fc.type !== "function_call") break;
        toolCalls.push({
          id: fc.call_id ?? crypto.randomUUID(),
          type: "function" as const,
          function: { name: fc.name ?? "", arguments: fc.arguments ?? "{}" },
        });
        i++;
      }
      messages.push({ role: "assistant", content: null, tool_calls: toolCalls });
    } else if (item.type === "function_call_output") {
      messages.push({
        role: "tool",
        tool_call_id: item.call_id ?? "",
        content: String(item.output ?? ""),
      });
      i++;
    } else {
      i++;
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// LlmClient
// ---------------------------------------------------------------------------

/**
 * Stateful LLM client bound to module config. Methods accept optional
 * per-request credentials override (per-user/per-chat keys).
 */
export class LlmClient {
  private globalClient: OpenAI;
  private supportsImagesCache: boolean | null = null;

  constructor(public readonly settings: LlmModuleSettings) {
    this.globalClient = new OpenAI({
      baseURL: settings.baseUrl,
      apiKey: settings.apiKey,
    });
  }

  private client(creds?: ApiCredentials): OpenAI {
    if (!creds) return this.globalClient;
    return new OpenAI({ baseURL: creds.baseUrl, apiKey: creds.apiKey });
  }

  /** One-shot non-streaming call. */
  async ask(instructions: string, input: string, creds?: ApiCredentials): Promise<LlmResponse> {
    if (this.settings.useChatCompletions) {
      const completion = await this.client(creds).chat.completions.create({
        model: creds?.model ?? this.settings.model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: input },
        ],
        max_tokens: this.settings.maxCompletionTokens,
      });
      return { output_text: completion.choices[0]?.message?.content ?? "", output: [] };
    }
    const res = await this.client(creds).responses.create({
      model: creds?.model ?? this.settings.model,
      instructions,
      input,
      max_output_tokens: this.settings.maxCompletionTokens,
    });
    return { output_text: res.output_text, output: res.output as unknown as LlmResponse["output"] };
  }

  /** Streaming response. Caller drives events / awaits .finalResponse(). */
  askStream(
    instructions: string,
    input: ResponseInputItem[],
    tools?: { name: string; description: string; parameters: Record<string, unknown> }[],
    creds?: ApiCredentials
  ): LlmStream {
    if (this.settings.useChatCompletions) {
      return this.askStreamViaChat(instructions, input, tools, creds) as unknown as LlmStream;
    }
    // Responses API stream satisfies LlmStream structurally
    return this.askStreamViaResponses(instructions, input, tools, creds) as unknown as LlmStream;
  }

  private askStreamViaResponses(
    instructions: string,
    input: ResponseInputItem[],
    tools?: { name: string; description: string; parameters: Record<string, unknown> }[],
    creds?: ApiCredentials
  ) {
    const openaiTools = tools?.length
      ? tools.map((t) => ({
          type: "function" as const,
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          strict: false,
        }))
      : undefined;
    return this.client(creds).responses.stream({
      model: creds?.model ?? this.settings.model,
      instructions,
      input,
      max_output_tokens: this.settings.maxCompletionTokens,
      ...(openaiTools ? { tools: openaiTools } : {}),
    });
  }

  private askStreamViaChat(
    instructions: string,
    input: ResponseInputItem[],
    tools?: { name: string; description: string; parameters: Record<string, unknown> }[],
    creds?: ApiCredentials
  ): LlmStream {
    const messages = toChatMessages(input, instructions);

    const chatTools = tools?.length
      ? tools.map((t) => ({
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        }))
      : undefined;

    const streamPromise = this.client(creds).chat.completions.create({
      model: creds?.model ?? this.settings.model,
      messages,
      max_tokens: this.settings.maxCompletionTokens,
      ...(chatTools ? { tools: chatTools } : {}),
      stream: true,
    });

    return new ChatCompletionsStreamAdapter(streamPromise) as unknown as LlmStream;
  }

  /** Probe OpenRouter /models once to learn image capability. */
  async checkCapabilities(): Promise<void> {
    try {
      const res = await fetch(`${this.settings.baseUrl}/models`);
      if (!res.ok) {
        log.warn(`Models endpoint returned ${res.status}, skipping capability check`);
        return;
      }
      const data = await res.json();
      const found = (data.data as { id: string; architecture?: { modality?: string } }[])?.find(
        (m) => m.id === this.settings.model
      );
      if (found) {
        const modality = found.architecture?.modality ?? "";
        this.supportsImagesCache = modality.toLowerCase().includes("image");
        log.info(
          `Model "${this.settings.model}" image support: ${this.supportsImagesCache} (modality: "${modality}")`
        );
      } else {
        log.warn(`Model "${this.settings.model}" not found in models list`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn(`Could not fetch model capabilities: ${msg}`);
    }
  }

  /** Cached result of checkCapabilities — null if unknown. */
  supportsImages(): boolean | null {
    return this.supportsImagesCache;
  }

  /**
   * Generate (or edit) an image via the configured image provider.
   * Uses IMAGE_BASE_URL/IMAGE_API_KEY when set, otherwise falls back to the
   * main chat creds. Always uses IMAGE_MODEL. Per-user creds intentionally
   * NOT consulted — image generation is a server-level capability.
   */
  async generateImage(prompt: string, imageUrl?: string): Promise<Buffer | null> {
    const apiKey = this.settings.imageApiKey || this.settings.apiKey;
    const baseUrl = this.settings.imageBaseUrl || this.settings.baseUrl;

    const content: unknown = imageUrl
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ]
      : prompt;

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.settings.imageModel,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Image generation failed (${res.status}): ${body}`);
    }

    const data: {
      choices?: { message?: { images?: { image_url: { url: string } }[] } }[];
    } = await res.json();
    const images = data.choices?.[0]?.message?.images;
    if (!images?.length) return null;

    const dataUrl = images[0].image_url.url;
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;

    return Buffer.from(base64, "base64");
  }
}
