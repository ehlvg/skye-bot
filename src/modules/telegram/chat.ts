import type { ApiCredentials, LlmClient, ResponseInputItem } from "../llm/client.js";
import type { McpService } from "../mcp/service.js";
import type { MemoryService } from "../memory/service.js";
import type { ChatLogService } from "../chatLog/service.js";
import type { UserConfigService } from "../userConfig/service.js";
import type { WorkspaceService } from "../workspace/service.js";
import type { SkillsService } from "../skills/service.js";
import type { ToolDefinition } from "../../core/module.js";
import type { TenantContext } from "../../core/tenant.js";
import { buildSystemPrompt } from "../llm/prompt.js";
import { safeJsonParse, type ToolCallRecord } from "./helpers.js";
import { log } from "../../utils/log.js";

const SKILL_SLASH_RE = /\/([\w-]+)/g;

export interface ChatLoopDeps {
  llm: LlmClient;
  mcp: McpService;
  memory: MemoryService;
  chatLog: ChatLogService;
  userConfig: UserConfigService;
  workspace?: WorkspaceService;
  skills?: SkillsService;
  /** Built-in (non-MCP) tools — currently just memory tools. */
  builtinTools: ToolDefinition[];
  /** Extra tools from workspace/skills modules. */
  extraTools?: ToolDefinition[];
}

/**
 * Run the streaming Responses-API tool-call loop until the model returns a
 * final text response (or we hit the iteration cap). Tool calls — both
 * built-in (memory) and MCP — are executed, fed back, and surfaced via the
 * onToolCalls callback for UI rendering.
 */
export async function runChatLoop(
  deps: ChatLoopDeps,
  tenant: TenantContext,
  input: ResponseInputItem[],
  creds?: ApiCredentials,
  onChunk?: (snapshot: string) => void,
  onToolCalls?: (calls: ToolCallRecord[]) => void
): Promise<string> {
  // Extract skill slash commands from the last user message
  let skillPrompt = "";
  let effectiveInput = input;

  const lastInput = effectiveInput[effectiveInput.length - 1];
  if (lastInput?.type === "message" && Array.isArray(lastInput.content)) {
    const textParts: string[] = [];
    for (const part of lastInput.content as { type: string; text?: string }[]) {
      if (part.type === "input_text" && part.text) {
        const text = part.text;
        let replaced = text;
        const skillNames: string[] = [];
        let match: RegExpExecArray | null;
        SKILL_SLASH_RE.lastIndex = 0;
        while ((match = SKILL_SLASH_RE.exec(text)) !== null) {
          skillNames.push(match[1]);
        }

        if (skillNames.length > 0 && deps.skills && tenant.userId) {
          replaced = text.replace(SKILL_SLASH_RE, "").trim();
          for (const skillName of skillNames) {
            try {
              const manifest = await deps.skills.loadSkill(tenant.userId, skillName);
              if (manifest?.files["SKILL.md"]) {
                skillPrompt += `\n\n## Skill: ${skillName}\n\n${manifest.files["SKILL.md"]}`;
              }
            } catch {
              // skill not found, skip
            }
          }
        }
        textParts.push(replaced);
      }
    }

    // Modify the last input item to remove slash commands from the text
    if (skillPrompt) {
      const newContent = (lastInput.content as { type: string; text?: string }[]).map((p) => {
        if (p.type === "input_text") {
          return {
            ...p,
            text: p.text?.replace(SKILL_SLASH_RE, "").replace(/\s+/g, " ").trim() ?? "",
          };
        }
        return p;
      });
      effectiveInput = [
        ...effectiveInput.slice(0, -1),
        { ...lastInput, content: newContent } as ResponseInputItem,
      ];
    }
  }

  const memories = deps.memory.list(tenant.chatId);
  const chatContext = deps.chatLog.context(tenant.chatId);
  const mcpTools = deps.mcp.toolsFor(tenant.userId);
  const mcpToolNames = mcpTools.map((t) => t.name);

  const allTools = [
    ...deps.builtinTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    })),
    ...(deps.extraTools ?? []).map((t) => ({
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
  const instructions = buildSystemPrompt(
    memories,
    chatContext,
    mcpToolNames,
    userCfg?.systemPrompt,
    skillPrompt || undefined
  );

  // Log the request summary (last user item text + attachments).
  const lastItem = effectiveInput[effectiveInput.length - 1];
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

  const currentInput: ResponseInputItem[] = [...effectiveInput];
  let iterations = 0;

  while (iterations <= 5) {
    const stream = deps.llm.askStream(
      instructions,
      currentInput,
      allTools.length > 0 ? allTools : undefined,
      creds
    );

    if (onChunk) {
      stream.on("response.output_text.delta", (event) => onChunk(event.snapshot));
    }

    const response = await stream.finalResponse();

    const fnCalls = response.output.filter(
      (item): item is Extract<typeof item, { type: "function_call" }> =>
        item.type === "function_call"
    );

    if (fnCalls.length === 0) {
      if (response.output_text) return response.output_text;
      // Fallback for providers (e.g. Ollama) that return non-output_text shapes.
      for (const item of response.output) {
        if (item.type === "message") {
          const content = (item as { content?: unknown }).content;
          if (typeof content === "string") return content;
          if (Array.isArray(content)) {
            const text = (content as { text?: string; content?: string }[])
              .map((c) => c.text ?? c.content ?? "")
              .join("");
            if (text) return text;
          }
        }
      }
      return "";
    }

    const currentToolCalls: ToolCallRecord[] = [];
    const toolOutputItems: ResponseInputItem[] = [];
    const builtinMap = new Map(deps.builtinTools.map((t) => [t.name, t]));
    const extraMap = new Map((deps.extraTools ?? []).map((t) => [t.name, t]));

    for (const fc of fnCalls) {
      const args = safeJsonParse(fc.arguments);
      const isMcp = deps.mcp.isMcpTool(fc.name);
      currentToolCalls.push({ name: fc.name, args, isMcp });

      let result: string;
      if (isMcp) {
        result = await deps.mcp.execute(fc.name, args);
      } else {
        const tool = builtinMap.get(fc.name) ?? extraMap.get(fc.name);
        result = tool
          ? await Promise.resolve(tool.execute(args, tenant))
          : `Unknown tool: ${fc.name}`;
      }

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
