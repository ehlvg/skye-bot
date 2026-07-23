import {
  Agent,
  MaxTurnsExceededError,
  OpenAIProvider,
  Runner,
  setTracingDisabled,
  tool,
  type AgentInputItem,
  type HostedTool,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type RunStreamEvent,
  type StreamEvent,
} from "@openai/agents";
import type { ToolDefinition } from "../../core/module.js";
import { threadKey } from "../../core/tenant.js";
import { log } from "../../utils/log.js";
import { unwrapTextEnvelope } from "../../utils/markdown.js";
import { buildSystemPrompt } from "../llm/prompt.js";
import type { ModelEntry } from "../llm/config.js";
import { safeJsonParse } from "../telegram/helpers.js";
import type { AgentProfile, AgentRuntimeConfig } from "./config.js";
import type { AgentRunRequest, AgentRuntime, AgentRuntimeDeps } from "./types.js";

type RuntimeTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  timeoutMs?: number;
  isConnector: boolean;
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
};

class MeteredModel implements Model {
  constructor(
    private readonly inner: Model,
    private readonly modelId: string,
    private readonly providerData: Record<string, unknown>,
    private readonly beforeRound?: (modelId: string) => void,
    private readonly onUsage?: (
      usage: { promptTokens: number; completionTokens: number },
      modelId: string
    ) => void
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.beforeRound?.(this.modelId);
    const response = await this.inner.getResponse(this.withProviderData(request));
    this.recordUsage(response.usage.inputTokens, response.usage.outputTokens);
    return response;
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    this.beforeRound?.(this.modelId);
    for await (const event of this.inner.getStreamedResponse(this.withProviderData(request))) {
      if (event.type === "response_done") {
        this.recordUsage(event.response.usage.inputTokens, event.response.usage.outputTokens);
      }
      yield event;
    }
  }

  private recordUsage(promptTokens: number, completionTokens: number): void {
    this.onUsage?.({ promptTokens, completionTokens }, this.modelId);
  }

  private withProviderData(request: ModelRequest): ModelRequest {
    if (Object.keys(this.providerData).length === 0) return request;
    return {
      ...request,
      modelSettings: {
        ...request.modelSettings,
        providerData: {
          ...this.providerData,
          ...request.modelSettings.providerData,
        },
      },
    };
  }
}

export class OpenAIAgentsRuntime implements AgentRuntime {
  readonly engine = "openai_agents" as const;
  private readonly provider: OpenAIProvider;
  private readonly runner: Runner;

  constructor(
    private readonly deps: AgentRuntimeDeps,
    private readonly config: AgentRuntimeConfig
  ) {
    setTracingDisabled(!config.tracing);
    this.provider = new OpenAIProvider({
      apiKey: deps.llm.settings.apiKey,
      baseURL: deps.llm.settings.baseUrl,
      useResponses: !deps.llm.settings.useChatCompletions,
      strictFeatureValidation: false,
    });
    this.runner = new Runner({
      modelProvider: this.provider,
      modelSettings: {
        maxTokens: deps.llm.settings.maxCompletionTokens,
        parallelToolCalls: false,
      },
      tracingDisabled: !config.tracing,
      traceIncludeSensitiveData: config.trace_include_sensitive_data,
      workflowName: "Skye Telegram agent",
      toolNotFoundBehavior: "return_error_to_model",
      toolExecution: { maxFunctionToolConcurrency: 1 },
    });
  }

  async close(): Promise<void> {
    await this.provider.close();
  }

  async run(request: AgentRunRequest): Promise<string> {
    request.signal?.throwIfAborted();
    const prepared = await this.prepare(request);
    const failedCalls = new Set<string>();
    const sdkTools = prepared.tools.map((definition) => ({
      definition,
      tool: tool({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters as never,
        strict: false,
        timeoutMs: definition.timeoutMs ?? 60_000,
        timeoutBehavior: "error_as_result",
        execute: async (rawArgs: unknown, _context, details) => {
          const args = isRecord(rawArgs) ? rawArgs : {};
          try {
            return await definition.execute(args, details?.signal ?? request.signal);
          } catch (error) {
            const callId = details?.toolCall?.callId;
            if (callId) failedCalls.add(callId);
            const result = `Tool "${definition.name}" failed: ${error instanceof Error ? error.message : String(error)}`;
            log.warn(
              { err: error, tool: definition.name, chatId: request.tenant.chatId },
              "Agent SDK tool execution failed"
            );
            return result;
          }
        },
      }),
    }));
    const toolsForModel = (entry: ModelEntry) => [
      ...sdkTools
        .filter(
          ({ definition }) =>
            definition.isConnector ||
            !entry.builtinTools?.includes("sandbox") ||
            !definition.name.startsWith("sandbox_")
        )
        .map(({ tool: sdkTool }) => sdkTool),
      ...hostedToolsForModel(entry, this.deps.llm.settings.useChatCompletions),
    ];

    const processEvent = async (event: RunStreamEvent, streamText: boolean) => {
      if (event.type === "raw_model_stream_event") {
        if (streamText) prepared.consumeTextEvent(event, request.onChunk);
        return;
      }
      if (event.type !== "run_item_stream_event") return;
      const raw = event.item.rawItem;
      if (event.name === "tool_called" && raw?.type === "function_call") {
        const args = safeJsonParse(raw.arguments);
        const isConnector = this.deps.connectors.isConnectorTool(raw.name, request.tenant.userId);
        this.deps.chatLog.appendConversation(request.tenant.chatId, threadKey(request.tenant), {
          role: "assistant",
          content: {
            type: "function_call",
            call_id: raw.callId,
            name: raw.name,
            arguments: raw.arguments,
          },
          text: summarizeFunctionCall(raw.name, raw.arguments),
        });
        request.onToolCalls?.([{ name: raw.name, args, isConnector }]);
        return;
      }
      if (event.name === "tool_output" && raw?.type === "function_call_result") {
        const output = stringifyToolOutput(raw.output);
        const failed =
          failedCalls.has(raw.callId) || /(?:failed|timed out):?/i.test(output.slice(0, 160));
        this.deps.chatLog.appendConversation(request.tenant.chatId, threadKey(request.tenant), {
          role: "tool",
          content: {
            call_id: raw.callId,
            name: raw.name,
            output,
            failed,
          },
          text: `tool ${raw.name} ${failed ? "failed" : "ok"}: ${output.slice(0, 500)}`,
        });
      }
    };

    const specialistAgents = await Promise.all(
      prepared.profiles.map(async (profile) => {
        const entry = this.modelForProfile(profile, prepared.modelEntry);
        const model = await this.meteredModel(entry, request);
        return {
          profile,
          agent: new Agent({
            name: profile.name,
            handoffDescription: profile.description,
            instructions: prepared.instructionsFor(profile),
            model,
            tools: toolsForModel(entry),
          }),
        };
      })
    );

    const delegateTools = specialistAgents
      .filter(({ profile }) => profile.id !== prepared.activeProfile?.id)
      .map(({ profile, agent }) =>
        agent.asTool({
          toolName: `delegate_${profile.id}`,
          toolDescription: profile.description,
          runOptions: {
            maxTurns: this.config.subagent_max_turns,
            signal: request.signal,
          },
          onStream: ({ event }) => processEvent(event, false),
        })
      );

    const rootEntry = prepared.activeProfile
      ? this.modelForProfile(prepared.activeProfile, prepared.modelEntry)
      : prepared.modelEntry;
    const rootModel = await this.meteredModel(rootEntry, request);
    const rootAgent = new Agent({
      name: prepared.activeProfile?.name ?? "Skye",
      instructions: prepared.rootInstructions,
      model: rootModel,
      tools: [...toolsForModel(rootEntry), ...delegateTools],
    });
    const input = toAgentInput(request.input);

    try {
      return await this.runStream(rootAgent, input, request, processEvent, this.config.max_turns);
    } catch (error) {
      if (!(error instanceof MaxTurnsExceededError) || !error.state) throw error;
      log.warn(
        {
          chatId: request.tenant.chatId,
          model: prepared.modelEntry.model,
          maxTurns: this.config.max_turns,
        },
        "Agent SDK reached the turn limit; requesting final synthesis"
      );
      const finalAgent = rootAgent.clone({
        tools: [],
        instructions: `${prepared.rootInstructions}\n\n## Tool limit reached\n\nDo not call any more tools. Use the results already available and give the user your best complete final answer now.`,
      });
      return this.runStream(finalAgent, error.state.history, request, processEvent, 1);
    }
  }

  private async runStream(
    agent: Agent,
    input: AgentInputItem[],
    request: AgentRunRequest,
    processEvent: (event: RunStreamEvent, streamText: boolean) => Promise<void>,
    maxTurns: number
  ): Promise<string> {
    const stream = await this.runner.run(agent, input, {
      stream: true,
      maxTurns,
      signal: request.signal,
    });
    for await (const event of stream) await processEvent(event, true);
    await stream.completed;
    if (stream.error) throw stream.error;
    const text = unwrapTextEnvelope(
      typeof stream.finalOutput === "string" ? stream.finalOutput : ""
    );
    if (!text && !request.acceptEmptyFinal?.()) {
      throw new Error("Agents SDK returned an empty final response");
    }
    if (text) {
      this.deps.chatLog.appendConversation(request.tenant.chatId, threadKey(request.tenant), {
        role: "assistant",
        content: text,
        text,
      });
    }
    return text;
  }

  private async meteredModel(entry: ModelEntry, request: AgentRunRequest): Promise<Model> {
    const model = await this.provider.getModel(entry.model);
    return new MeteredModel(
      model,
      entry.id,
      providerDataForModel(entry, request.input, this.deps.llm.settings.pdfEngine),
      request.beforeRound,
      request.onUsage
    );
  }

  private modelForProfile(profile: AgentProfile, fallback: ModelEntry): ModelEntry {
    if (!profile.model_id) return fallback;
    const entry = this.deps.llm.resolveModel(profile.model_id);
    if (entry.provider === "perplexity") {
      log.warn(
        { agentId: profile.id, modelId: profile.model_id },
        "Perplexity agent profiles use the active OpenRouter model in OpenAIAgentsRuntime"
      );
      return fallback;
    }
    return entry;
  }

  private async prepare(request: AgentRunRequest) {
    const memoryQuery = extractInputText(request.input);
    const memories = this.deps.memory.context(request.tenant.chatId, memoryQuery, 12);
    const chatContext = this.deps.chatLog.context(request.tenant.chatId, request.tenant.threadId);
    const connectorTools =
      request.allowConnectorTools === false
        ? []
        : await this.deps.connectors.toolsFor(request.tenant.userId);
    const userCfg = request.tenant.userId
      ? this.deps.userConfig.get(request.tenant.userId)
      : undefined;
    const threadPrompt = this.deps.chatConfig.getPrompt(
      request.tenant.chatId,
      request.tenant.threadId
    );
    const personalAgentId = request.tenant.userId
      ? this.deps.userAgents.getSelection(
          request.tenant.userId,
          request.tenant.chatId,
          request.tenant.threadId
        )
      : undefined;
    const selectedAgentId =
      personalAgentId ??
      this.deps.chatConfig.getAgent(request.tenant.chatId, request.tenant.threadId);
    const profiles = [
      ...this.config.agents.filter((profile) => profile.enabled),
      ...(request.tenant.userId ? this.deps.userAgents.profiles(request.tenant.userId) : []),
    ];
    const activeProfile = profiles.find((profile) => profile.id === selectedAgentId);
    const modelEntry = this.deps.llm.resolveModel(request.modelId);
    const tools: RuntimeTool[] = [
      ...request.builtinTools.map((definition) => this.builtinRuntimeTool(definition, request)),
      ...connectorTools.map((definition) => ({
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
        isConnector: true,
        execute: (args: Record<string, unknown>, signal?: AbortSignal) =>
          this.deps.connectors.execute(definition.name, args, request.tenant.userId, signal),
      })),
    ];
    const promptFor = (profile?: AgentProfile) => {
      const promptModel = profile ? this.modelForProfile(profile, modelEntry) : modelEntry;
      const configuredPrompt = profile
        ? `${profile.instructions}${threadPrompt ? `\n\nAdditional instructions for this chat or topic:\n${threadPrompt}` : ""}`
        : threadPrompt;
      return buildSystemPrompt(
        memories,
        chatContext,
        connectorTools.map((definition) => definition.name),
        userCfg?.systemPrompt,
        this.deps.sandbox?.isEnabled(),
        request.hasReferenceImages,
        !!this.deps.reminders,
        profile?.name ?? promptModel.name,
        promptModel.builtinTools,
        request.owner,
        !!this.deps.channel,
        userCfg?.personality,
        configuredPrompt
      );
    };
    let streamedText = "";
    return {
      modelEntry,
      profiles,
      activeProfile,
      tools,
      rootInstructions: promptFor(activeProfile),
      instructionsFor: (profile: AgentProfile) =>
        `${promptFor(profile)}\n\nYou are working as a specialist subagent. Complete the delegated task and return concise findings to the coordinating agent.`,
      consumeTextEvent: (
        event: Extract<RunStreamEvent, { type: "raw_model_stream_event" }>,
        onChunk?: (snapshot: string) => void
      ) => {
        if (event.data.type === "response_started") streamedText = "";
        if (event.data.type === "output_text_delta") {
          streamedText += event.data.delta;
          onChunk?.(streamedText);
        }
      },
    };
  }

  private builtinRuntimeTool(definition: ToolDefinition, request: AgentRunRequest): RuntimeTool {
    return {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      timeoutMs: definition.timeoutMs,
      isConnector: false,
      execute: async (args) => String(await definition.execute(args, request.tenant)),
    };
  }
}

export function toAgentInput(input: AgentRunRequest["input"]): AgentInputItem[] {
  const namesByCallId = new Map<string, string>();
  const converted: AgentInputItem[] = [];
  for (const source of input) {
    const item = source as {
      type?: string;
      role?: string;
      content?: unknown;
      call_id?: string;
      name?: string;
      arguments?: string;
      output?: string;
    };
    if (item.type === "function_call" && item.call_id && item.name) {
      namesByCallId.set(item.call_id, item.name);
      converted.push({
        type: "function_call",
        callId: item.call_id,
        name: item.name,
        arguments: item.arguments ?? "{}",
      } as AgentInputItem);
      continue;
    }
    if (item.type === "function_call_output" && item.call_id) {
      converted.push({
        type: "function_call_result",
        callId: item.call_id,
        name: namesByCallId.get(item.call_id) ?? "unknown_tool",
        status: "completed",
        output: item.output ?? "",
      } as AgentInputItem);
      continue;
    }
    if (item.type !== "message") continue;
    if (item.role === "assistant") {
      converted.push({
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: contentText(item.content) }],
      } as AgentInputItem);
      continue;
    }
    if (item.role === "system") {
      converted.push({ role: "system", content: contentText(item.content) } as AgentInputItem);
      continue;
    }
    converted.push({
      role: "user",
      content: convertUserContent(item.content),
    } as AgentInputItem);
  }
  return converted;
}

export function hostedToolsForModel(entry: ModelEntry, useChatCompletions: boolean): HostedTool[] {
  if (useChatCompletions) return [];
  return (entry.builtinTools ?? []).map((name) => ({
    type: "hosted_tool",
    name,
    providerData: { type: name },
  }));
}

export function providerDataForModel(
  entry: ModelEntry,
  input: AgentRunRequest["input"],
  pdfEngine: string
): Record<string, unknown> {
  const providerData: Record<string, unknown> = {};
  if (entry.preset) providerData.preset = entry.preset;
  if (pdfEngine && hasInputFile(input)) {
    providerData.plugins = [{ id: "file-parser", pdf: { engine: pdfEngine } }];
  }
  return providerData;
}

function convertUserContent(content: unknown): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return contentText(content);
  const converted: Array<Record<string, unknown>> = [];
  for (const part of content) {
    if (!isRecord(part) || typeof part.type !== "string") continue;
    if (part.type === "input_text") {
      converted.push({ type: "input_text", text: String(part.text ?? "") });
      continue;
    }
    if (part.type === "input_image") {
      converted.push({ type: "input_image", image: part.image_url });
      continue;
    }
    if (part.type === "input_file") {
      converted.push({
        type: "input_file",
        file: part.file_data,
        filename: part.filename,
      });
    }
  }
  return converted;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) =>
      isRecord(part) ? String(part.text ?? part.content ?? part.transcript ?? "") : ""
    )
    .join("");
}

function extractInputText(input: AgentRunRequest["input"]): string {
  const last = input.at(-1) as { type?: string; content?: unknown } | undefined;
  if (last?.type !== "message") return "";
  return contentText(last.content).slice(0, 500);
}

function hasInputFile(input: AgentRunRequest["input"]): boolean {
  return input.some((source) => {
    const item = source as { type?: string; content?: unknown };
    if (item.type !== "message" || !Array.isArray(item.content)) return false;
    return item.content.some((part) => isRecord(part) && part.type === "input_file");
  });
}

function summarizeFunctionCall(name: string, argsRaw: string): string {
  const args = safeJsonParse(argsRaw);
  const brief = [args.prompt, args.content, args.command, args.query]
    .find((value) => typeof value === "string")
    ?.slice(0, 160);
  return `${name}(${brief ?? argsRaw.slice(0, 160)})`;
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (isRecord(output) && output.type === "text" && typeof output.text === "string") {
    return output.text;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
