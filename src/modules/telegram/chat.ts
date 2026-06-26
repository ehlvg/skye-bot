import type { LlmClient, ResponseInputItem } from "../llm/client.js";
import type { McpService } from "../mcp/service.js";
import type { MemoryService } from "../memory/service.js";
import type { ChatLogService } from "../chatLog/service.js";
import type { UserConfigService } from "../userConfig/service.js";
import type { SandboxService } from "../sandbox/service.js";
import type { RemindersService } from "../reminders/service.js";
import type { ToolDefinition } from "../../core/module.js";
import type { TenantContext } from "../../core/tenant.js";
import { threadKey } from "../../core/tenant.js";
import { buildSystemPrompt } from "../llm/prompt.js";
import { safeJsonParse, type ToolCallRecord } from "./helpers.js";
import { log } from "../../utils/log.js";

export interface ChatLoopDeps {
  llm: LlmClient;
  mcp: McpService;
  memory: MemoryService;
  chatLog: ChatLogService;
  userConfig: UserConfigService;
  sandbox?: SandboxService;
  reminders?: RemindersService;
  builtinTools: ToolDefinition[];
  hasReferenceImages?: boolean;
  /** Masked model id to run this turn on (resolved from the user's billing account). */
  modelId?: string;
  /** Meter one LLM round-trip's token usage against the caller's quota. */
  onUsage?: (usage: { promptTokens: number; completionTokens: number }, modelId: string) => void;
  /** Bot owner info (name + Telegram handle) to weight in the system prompt. */
  owner?: { name: string; tag: string };
}

/**
 * Run the streaming Responses-API tool-call loop until the model returns a
 * final text response (or we hit the iteration cap). Tool calls — both
 * built-in (memory) and MCP — are executed, fed back, and surfaced via the
 * onToolCalls callback for UI rendering.
 *
 * Every step (assistant function calls, tool outputs, final assistant text)
 * is persisted to the chatLog so Skye retains full conversational context —
 * including failed tool calls — across restarts.
 */
export async function runChatLoop(
  deps: ChatLoopDeps,
  tenant: TenantContext,
  input: ResponseInputItem[],
  onChunk?: (snapshot: string) => void,
  onToolCalls?: (calls: ToolCallRecord[]) => void
): Promise<string> {
  const memories = deps.memory.list(tenant.chatId);
  const chatContext = deps.chatLog.context(tenant.chatId);
  const mcpTools = deps.mcp.toolsFor(tenant.userId);
  const mcpToolNames = mcpTools.map((t) => t.name);
  const tk = threadKey(tenant);

  const allTools = [
    ...deps.builtinTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
    ...mcpTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
  ];

  const userCfg = tenant.userId ? deps.userConfig.get(tenant.userId) : undefined;
  const modelEntry = deps.llm.resolveModel(deps.modelId);
  const instructions = buildSystemPrompt(
    memories,
    chatContext,
    mcpToolNames,
    userCfg?.systemPrompt,
    deps.sandbox?.isEnabled(),
    deps.hasReferenceImages,
    !!deps.reminders,
    modelEntry.name,
    deps.owner
  );

  // Log the request summary (last user item text + attachments).
  const lastItem = input[input.length - 1];
  let requestSummary = "";
  const requestAttachments: string[] = [];
  if (lastItem?.type === "message" && Array.isArray(lastItem.content)) {
    for (const part of lastItem.content as { type: string; text?: string }[]) {
      if (part.type === "input_text") requestSummary += part.text ?? "";
      else if (part.type === "input_image") requestAttachments.push("image");
      else requestAttachments.push(part.type);
    }
    requestSummary = requestSummary.slice(0, 200);
  } else if (
    lastItem?.type === "message" &&
    typeof (lastItem as { content?: unknown }).content === "string"
  ) {
    requestSummary = (lastItem as { content: string }).content.slice(0, 200);
  }
  log.info(
    { chatId: tenant.chatId, requestSummary, requestAttachments, toolCount: allTools.length },
    "LLM request"
  );

  const currentInput: ResponseInputItem[] = [...input];
  let iterations = 0;

  while (iterations <= 5) {
    const stream = deps.llm.askStream(
      instructions,
      currentInput,
      allTools.length > 0 ? allTools : undefined,
      modelEntry.id
    );

    if (onChunk) {
      stream.on("response.output_text.delta", (event) => onChunk(event.snapshot));
    }

    const response = await stream.finalResponse();

    if (response.usage && deps.onUsage) {
      try {
        deps.onUsage(response.usage, modelEntry.id);
      } catch (e) {
        log.warn({ err: e }, "onUsage metering failed");
      }
    }

    const fnCalls = response.output.filter((item) => item.type === "function_call") as Array<{
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }>;

    if (fnCalls.length === 0) {
      const finalText = extractFinalText(response);
      if (finalText) {
        deps.chatLog.appendConversation(tenant.chatId, tk, {
          role: "assistant",
          content: finalText,
          text: finalText,
        });
      }
      return finalText;
    }

    // Persist assistant function calls so tool usage survives restarts.
    for (const fc of fnCalls) {
      const summary = summarizeFunctionCall(fc.name, fc.arguments);
      deps.chatLog.appendConversation(tenant.chatId, tk, {
        role: "assistant",
        content: fc as unknown,
        text: summary,
      });
    }

    const currentToolCalls: ToolCallRecord[] = [];
    const toolOutputItems: ResponseInputItem[] = [];
    const builtinMap = new Map(deps.builtinTools.map((t) => [t.name, t]));

    for (const fc of fnCalls) {
      const args = safeJsonParse(fc.arguments);
      const isMcp = deps.mcp.isMcpTool(fc.name);
      currentToolCalls.push({ name: fc.name, args, isMcp });

      let result: string;
      let failed = false;
      try {
        if (isMcp) {
          result = await deps.mcp.execute(fc.name, args);
        } else {
          const tool = builtinMap.get(fc.name);
          result = tool
            ? await Promise.resolve(tool.execute(args, tenant))
            : `Unknown tool: ${fc.name}`;
        }
      } catch (e) {
        failed = true;
        result = `Tool "${fc.name}" failed: ${
          e instanceof Error ? e.message : String(e)
        }`;
        log.warn({ err: e, tool: fc.name, chatId: tenant.chatId }, "Tool execution failed");
      }

      // Persist tool output (success or failure) to the conversation log.
      deps.chatLog.appendConversation(tenant.chatId, tk, {
        role: "tool",
        content: { call_id: fc.call_id, name: fc.name, output: result, failed },
        text: `tool ${fc.name} ${failed ? "failed" : "ok"}: ${result.slice(0, 500)}`,
      });

      toolOutputItems.push({
        type: "function_call_output",
        call_id: fc.call_id,
        output: result,
      } as ResponseInputItem);
    }

    for (const fc of fnCalls) currentInput.push(fc as ResponseInputItem);
    currentInput.push(...toolOutputItems);

    if (onToolCalls && currentToolCalls.length > 0) {
      onToolCalls(currentToolCalls);
    }

    iterations++;
  }
  return "";
}

function extractFinalText(response: {
  output_text?: string;
  output: unknown[];
}): string {
  if (response.output_text) return response.output_text;
  for (const item of response.output) {
    if (typeof item !== "object" || item === null) continue;
    const it = item as { type?: string; content?: unknown };
    if (it.type !== "message") continue;
    const content = it.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const text = (content as { text?: string; content?: string }[])
        .map((c) => c.text ?? c.content ?? "")
        .join("");
      if (text) return text;
    }
  }
  return "";
}

function summarizeFunctionCall(name: string, argsRaw: string): string {
  let brief = "";
  try {
    const a = JSON.parse(argsRaw) as Record<string, unknown>;
    if (typeof a.prompt === "string") brief = a.prompt.slice(0, 160);
    else if (typeof a.content === "string") brief = a.content.slice(0, 160);
    else if (typeof a.command === "string") brief = a.command.slice(0, 160);
    else if (typeof a.query === "string") brief = a.query.slice(0, 160);
    else brief = argsRaw.slice(0, 160);
  } catch {
    brief = argsRaw.slice(0, 160);
  }
  return `called ${name}(${brief})`;
}
