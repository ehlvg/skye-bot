import type { AgentProfile, AgentRuntimeConfig } from "./config.js";
import type { AgentRunRequest, AgentRuntime, AgentRuntimeDeps } from "./types.js";
import { OpenAIAgentsRuntime } from "./openai.js";
import { runChatLoop } from "../telegram/chat.js";
import { log } from "../../utils/log.js";

class LegacyAgentRuntime implements AgentRuntime {
  readonly engine = "legacy" as const;

  constructor(private readonly deps: AgentRuntimeDeps) {}

  run(request: AgentRunRequest): Promise<string> {
    return runChatLoop(
      {
        ...this.deps,
        builtinTools: request.builtinTools,
        allowConnectorTools: request.allowConnectorTools,
        hasReferenceImages: request.hasReferenceImages,
        modelId: request.modelId,
        beforeRound: request.beforeRound,
        onUsage: request.onUsage,
        owner: request.owner,
      },
      request.tenant,
      request.input,
      request.onChunk,
      request.onToolCalls,
      request.signal
    );
  }
}

export class AgentRuntimeService implements AgentRuntime {
  readonly engine: AgentRuntime["engine"];
  private readonly legacy: LegacyAgentRuntime;
  private readonly openaiAgents: OpenAIAgentsRuntime;

  constructor(
    private readonly deps: AgentRuntimeDeps,
    private readonly config: AgentRuntimeConfig
  ) {
    this.engine = config.engine;
    this.legacy = new LegacyAgentRuntime(deps);
    this.openaiAgents = new OpenAIAgentsRuntime(deps, config);
  }

  run(request: AgentRunRequest): Promise<string> {
    const model = this.deps.llm.resolveModel(request.modelId);
    if (this.engine === "openai_agents" && model.provider !== "perplexity") {
      return this.openaiAgents.run(request);
    }
    if (this.engine === "openai_agents" && model.provider === "perplexity") {
      log.info(
        { modelId: model.id, chatId: request.tenant.chatId },
        "Using legacy agent runtime for optional Perplexity model"
      );
    }
    return this.legacy.run(request);
  }

  profiles(): AgentProfile[] {
    return this.config.agents.filter((profile) => profile.enabled);
  }

  profilesFor(userId?: number): AgentProfile[] {
    return [...this.profiles(), ...(userId ? this.deps.userAgents.profiles(userId) : [])];
  }

  profile(id: string | undefined, userId?: number): AgentProfile | undefined {
    return id ? this.profilesFor(userId).find((profile) => profile.id === id) : undefined;
  }

  activeProfile(chatId: number, threadId?: number, userId?: number): AgentProfile | undefined {
    const personalId = userId
      ? this.deps.userAgents.getSelection(userId, chatId, threadId)
      : undefined;
    return this.profile(personalId ?? this.deps.chatConfig.getAgent(chatId, threadId), userId);
  }

  async close(): Promise<void> {
    await this.openaiAgents.close();
  }
}
