import type { SkyeModule } from "../../core/module.js";
import { InlineKeyboard } from "grammy";
import { ZodError } from "zod";
import { agentRuntimeConfigSchema } from "./config.js";
import { migrations } from "./migrations.js";
import { AgentRuntimeService } from "./service.js";
import {
  isPersonalProfileId,
  personalProfileId,
  UserAgentService,
  type UserAgentInput,
} from "./userAgents.js";

let serviceRef: AgentRuntimeService | null = null;

declare module "../../core/module.js" {
  interface SkyeServices {
    agentRuntime: AgentRuntimeService;
  }
}

function scopeLabel(threadId?: number): string {
  return threadId == null ? "this chat" : "this topic";
}

function parseAgentForm(raw: string): UserAgentInput | undefined {
  const [id, name, description, ...instructionParts] = raw.split("|").map((part) => part.trim());
  const instructions = instructionParts.join(" | ").trim();
  if (!id || !name || !description || !instructions) return undefined;
  return { id, name, description, instructions };
}

const transliteration: Record<string, string> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

export function agentIdFromName(name: string): string {
  const transliterated = [...name.toLowerCase()]
    .map((character) => transliteration[character] ?? character)
    .join("");
  const slug = transliterated
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32)
    .replace(/_+$/g, "");
  const candidate = /^[a-z]/.test(slug) ? slug : `agent_${slug || crypto.randomUUID().slice(0, 8)}`;
  return candidate.slice(0, 32).replace(/_+$/g, "");
}

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Invalid agent data";
  if (error instanceof Error) return error.message;
  return String(error);
}

const editAgentHelp = [
  "Use this format:",
  "<id> | <name> | <description> | <instructions>",
  "",
  "Example:",
  "/edit_agent my_copywriter | Copywriter | Writes polished marketing copy | Ask about the audience and produce concise copy.",
].join("\n");

const forceReply = (placeholder: string) => ({
  force_reply: true as const,
  selective: true,
  input_field_placeholder: placeholder,
});

export const agentRuntimeModule: SkyeModule = {
  name: "agentRuntime",
  configSchema: agentRuntimeConfigSchema,
  migrations,
  init(ctx) {
    const userAgents = new UserAgentService(ctx.db, ctx.config.agent_runtime.max_user_agents);
    const service = new AgentRuntimeService(
      {
        llm: ctx.services.get("llm"),
        connectors: ctx.services.get("connectors"),
        memory: ctx.services.get("memory"),
        chatLog: ctx.services.get("chatLog"),
        userConfig: ctx.services.get("userConfig"),
        chatConfig: ctx.services.get("chatConfig"),
        sandbox: ctx.services.has("sandbox") ? ctx.services.get("sandbox") : undefined,
        reminders: ctx.services.has("reminders") ? ctx.services.get("reminders") : undefined,
        channel: ctx.services.has("channel") ? ctx.services.get("channel") : undefined,
        userAgents,
      },
      ctx.config.agent_runtime
    );
    serviceRef = service;
    const chatConfig = ctx.services.get("chatConfig");
    return {
      service,
      commands: [
        {
          name: "agents",
          description: "List available agent profiles",
          handler: async (telegram, tenant) => {
            const profiles = service.profilesFor(tenant.userId);
            const selected = service.activeProfile(tenant.chatId, tenant.threadId, tenant.userId);
            const lines = profiles.map(
              (profile) =>
                `${profile.id === selected?.id ? "●" : "○"} ${profile.name} (${profile.id}) — ${profile.description}`
            );
            await telegram.reply(
              [
                `Active for ${scopeLabel(tenant.threadId)}: ${selected?.name ?? "default Skye"}`,
                "",
                ...(lines.length > 0 ? lines : ["No custom agent profiles are configured."]),
                "",
                "Switch with /agent <id>, or use /agent default.",
              ].join("\n"),
              { reply_to_message_id: telegram.message?.message_id }
            );
          },
        },
        {
          name: "agent",
          description: "Switch agent for this chat or topic",
          handler: async (telegram, tenant) => {
            const requested = telegram.match?.toString().trim() ?? "";
            if (!requested) {
              const selected = service.activeProfile(tenant.chatId, tenant.threadId, tenant.userId);
              await telegram.reply(
                `Active agent for ${scopeLabel(tenant.threadId)}: ${selected?.name ?? "default Skye"}. Use /agents to see profiles.`,
                { reply_to_message_id: telegram.message?.message_id }
              );
              return;
            }
            if (["default", "skye", "reset"].includes(requested.toLowerCase())) {
              if (tenant.userId) {
                userAgents.resetSelection(tenant.userId, tenant.chatId, tenant.threadId);
              }
              chatConfig.resetAgent(tenant.chatId, tenant.threadId);
              await telegram.reply(`Switched ${scopeLabel(tenant.threadId)} to default Skye.`, {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }
            const profile = service.profile(requested, tenant.userId);
            if (!profile) {
              await telegram.reply(`Unknown agent "${requested}". Use /agents to see profiles.`, {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }
            if (isPersonalProfileId(profile.id)) {
              if (!tenant.userId) {
                await telegram.reply("Personal agents require a Telegram user account.", {
                  reply_to_message_id: telegram.message?.message_id,
                });
                return;
              }
              userAgents.setSelection(tenant.userId, tenant.chatId, tenant.threadId, profile.id);
            } else {
              if (tenant.userId) {
                userAgents.resetSelection(tenant.userId, tenant.chatId, tenant.threadId);
              }
              chatConfig.setAgent(tenant.chatId, tenant.threadId, profile.id);
            }
            await telegram.reply(`Switched ${scopeLabel(tenant.threadId)} to ${profile.name}.`, {
              reply_to_message_id: telegram.message?.message_id,
            });
          },
        },
        {
          name: "my_agents",
          description: "List your personal agents",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const agents = userAgents.list(tenant.userId);
            const active = userAgents.getSelection(tenant.userId, tenant.chatId, tenant.threadId);
            const lines = agents.map((agent) => {
              const id = personalProfileId(agent.id);
              return `${id === active ? "●" : "○"} ${agent.name} (${id}) — ${agent.description}`;
            });
            await telegram.reply(
              [
                ...(lines.length > 0 ? lines : ["You have no personal agents yet."]),
                "",
                `Limit: ${agents.length}/${ctx.config.agent_runtime.max_user_agents}`,
                "Create one with /create_agent.",
              ].join("\n"),
              { reply_to_message_id: telegram.message?.message_id }
            );
          },
        },
        {
          name: "create_agent",
          description: "Create a private personal agent",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const count = userAgents.list(tenant.userId).length;
            if (count >= ctx.config.agent_runtime.max_user_agents) {
              await telegram.reply(
                `You already have the maximum of ${ctx.config.agent_runtime.max_user_agents} personal agents. Delete one with /delete_agent first.`,
                { reply_to_message_id: telegram.message?.message_id }
              );
              return;
            }
            userAgents.startDraft(tenant.userId, tenant.chatId, tenant.threadId);
            await telegram.reply(
              [
                "Let's create your personal agent.",
                "",
                "Step 1 of 3 — What should I call it?",
                "For example: Research Assistant or Copywriter",
                "",
                "You can stop at any time with /cancel_agent.",
              ].join("\n"),
              {
                reply_to_message_id: telegram.message?.message_id,
                reply_markup: forceReply("Agent name"),
              }
            );
          },
        },
        {
          name: "cancel_agent",
          description: "Cancel personal agent creation",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const cancelled = userAgents.cancelDraft(tenant.userId, tenant.chatId, tenant.threadId);
            await telegram.reply(
              cancelled ? "Agent creation cancelled." : "There is no agent creation in progress.",
              { reply_to_message_id: telegram.message?.message_id }
            );
          },
        },
        {
          name: "edit_agent",
          description: "Edit one of your personal agents",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const form = parseAgentForm(telegram.match?.toString().trim() ?? "");
            if (!form) {
              await telegram.reply(editAgentHelp, {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }
            try {
              const agent = userAgents.update(tenant.userId, form.id, {
                name: form.name,
                description: form.description,
                instructions: form.instructions,
              });
              await telegram.reply(
                `Updated private agent ${agent.name} (${personalProfileId(agent.id)}).`,
                { reply_to_message_id: telegram.message?.message_id }
              );
            } catch (error) {
              await telegram.reply(`Could not update agent: ${errorMessage(error)}`, {
                reply_to_message_id: telegram.message?.message_id,
              });
            }
          },
        },
        {
          name: "delete_agent",
          description: "Delete one of your personal agents",
          handler: async (telegram, tenant) => {
            if (!tenant.userId) return;
            const id = telegram.match?.toString().trim() ?? "";
            if (!id) {
              await telegram.reply("Add the agent id, for example: /delete_agent my_copywriter", {
                reply_to_message_id: telegram.message?.message_id,
              });
              return;
            }
            const deleted = userAgents.delete(tenant.userId, id);
            await telegram.reply(
              deleted
                ? `Deleted private agent ${personalProfileId(id)}.`
                : `Personal agent ${personalProfileId(id)} does not exist.`,
              { reply_to_message_id: telegram.message?.message_id }
            );
          },
        },
      ],
      telegramHandlers: [
        {
          on: "message:text",
          order: 10,
          handler: async (telegram, tenant, next) => {
            if (!tenant.userId) return next();
            const draft = userAgents.getDraft(tenant.userId, tenant.chatId, tenant.threadId);
            const text = telegram.message?.text?.trim() ?? "";
            if (!draft || text.startsWith("/")) return next();

            if (draft.step === "name") {
              if (!text || text.length > 80) {
                await telegram.reply("Send a name between 1 and 80 characters.", {
                  reply_markup: forceReply("Agent name"),
                });
                return;
              }
              userAgents.saveDraft(tenant.userId, tenant.chatId, tenant.threadId, {
                ...draft,
                step: "description",
                name: text,
              });
              await telegram.reply(
                [
                  `Great — ${text}.`,
                  "",
                  "Step 2 of 3 — What is this agent good at?",
                  "Write one short description. This helps Skye decide when to delegate work to it.",
                ].join("\n"),
                { reply_markup: forceReply("What does this agent specialize in?") }
              );
              return;
            }

            if (draft.step === "description") {
              if (!text || text.length > 500) {
                await telegram.reply("Send a description between 1 and 500 characters.", {
                  reply_markup: forceReply("Short agent description"),
                });
                return;
              }
              userAgents.saveDraft(tenant.userId, tenant.chatId, tenant.threadId, {
                ...draft,
                step: "instructions",
                description: text,
              });
              await telegram.reply(
                [
                  "Step 3 of 3 — How should it work?",
                  "",
                  "Describe its role, tone, rules, and what a good answer should look like. You can write several paragraphs.",
                ].join("\n"),
                { reply_markup: forceReply("Detailed instructions") }
              );
              return;
            }

            if (draft.step === "instructions") {
              if (!text || text.length > 16_000) {
                await telegram.reply("Send instructions between 1 and 16,000 characters.", {
                  reply_markup: forceReply("Detailed instructions"),
                });
                return;
              }
              const completed = userAgents.saveDraft(
                tenant.userId,
                tenant.chatId,
                tenant.threadId,
                { ...draft, step: "confirm", instructions: text }
              );
              const preview = text.length > 1_000 ? `${text.slice(0, 1_000)}…` : text;
              await telegram.reply(
                [
                  "Ready to create this private agent:",
                  "",
                  `Name: ${completed.name}`,
                  `Specialty: ${completed.description}`,
                  "Instructions:",
                  preview,
                ].join("\n"),
                {
                  reply_markup: new InlineKeyboard()
                    .text("Create and select", "agent:create:confirm")
                    .text("Cancel", "agent:create:cancel"),
                }
              );
              return;
            }

            await telegram.reply("Use the buttons above to create the agent, or /cancel_agent.");
          },
        },
        {
          on: "callback_query:data",
          order: 10,
          handler: async (telegram, tenant, next) => {
            const action = telegram.callbackQuery?.data;
            if (!action?.startsWith("agent:create:")) return next();
            if (!tenant.userId) return;
            const draft = userAgents.getDraft(tenant.userId, tenant.chatId, tenant.threadId);
            if (!draft || draft.step !== "confirm") {
              await telegram.answerCallbackQuery({ text: "This setup has expired." });
              return;
            }
            if (action === "agent:create:cancel") {
              userAgents.cancelDraft(tenant.userId, tenant.chatId, tenant.threadId);
              await telegram.answerCallbackQuery({ text: "Cancelled" });
              await telegram.reply("Agent creation cancelled.");
              return;
            }
            if (action !== "agent:create:confirm") return next();
            try {
              const baseId = agentIdFromName(draft.name!);
              let id = baseId;
              for (let suffix = 2; userAgents.get(tenant.userId, id); suffix++) {
                const suffixText = `_${suffix}`;
                id = `${baseId.slice(0, 32 - suffixText.length)}${suffixText}`;
              }
              const agent = userAgents.create(tenant.userId, {
                id,
                name: draft.name!,
                description: draft.description!,
                instructions: draft.instructions!,
              });
              userAgents.setSelection(tenant.userId, tenant.chatId, tenant.threadId, agent.id);
              userAgents.cancelDraft(tenant.userId, tenant.chatId, tenant.threadId);
              await telegram.answerCallbackQuery({ text: "Agent created" });
              await telegram.reply(
                `Created and selected ${agent.name} (${personalProfileId(agent.id)}) for ${scopeLabel(tenant.threadId)}.`
              );
            } catch (error) {
              await telegram.answerCallbackQuery({
                text: errorMessage(error).slice(0, 180),
                show_alert: true,
              });
            }
          },
        },
      ],
    };
  },
  async shutdown() {
    await serviceRef?.close();
    serviceRef = null;
  },
};

export type { AgentRuntime, AgentRunRequest, AgentRuntimeDeps } from "./types.js";
export { OpenAIAgentsRuntime } from "./openai.js";
export { AgentRuntimeService } from "./service.js";
export { UserAgentService } from "./userAgents.js";
