import type { SkyeModule } from "../../core/module.js";
import { migrations } from "./migrations.js";
import { buildRoutes } from "./routes.js";
import { sendRichReply } from "../telegram/helpers.js";
import {
  chatConfigService,
  getChatConfig,
  getChatThreadPrompt,
  resetChatThreadPrompt,
  setChatThreadPrompt,
  setChatVoiceMode,
  type ChatConfigService,
} from "./service.js";

export const MAX_CHAT_PROMPT_CHARS = 16_000;

function scopeLabel(threadId?: number): string {
  return threadId == null ? "this chat" : "this topic";
}

declare module "../../core/module.js" {
  interface SkyeServices {
    chatConfig: ChatConfigService;
  }
}

export const chatConfigModule: SkyeModule = {
  name: "chatConfig",
  migrations,
  init(ctx) {
    ctx.services.set("chatConfig", chatConfigService);
    return {
      service: chatConfigService,
      panelRoutes: buildRoutes(ctx),
      commands: [
        {
          name: "voice",
          description: "Toggle voice note responses",
          public: true,
          handler: async (ctx, tenant) => {
            const cfg = getChatConfig(tenant.chatId);
            const newState = !cfg.voiceMode;
            setChatVoiceMode(tenant.chatId, newState);
            await sendRichReply(
              ctx,
              newState
                ? "🎙 **Voice mode ON**\n\n_Text responses will be sent as voice notes._"
                : "📝 **Voice mode OFF**\n\n_Responses will be sent as text._"
            );
          },
        },
        {
          name: "set_prompt",
          description: "Set a custom prompt for this chat or topic",
          handler: async (ctx, tenant) => {
            const prompt = ctx.match?.toString().trim() ?? "";
            if (!prompt) {
              await sendRichReply(
                ctx,
                `Add the custom prompt after the command, for example:\n\n\`/set_prompt You are a concise coding mentor.\``
              );
              return;
            }
            if (prompt.length > MAX_CHAT_PROMPT_CHARS) {
              await sendRichReply(
                ctx,
                `The custom prompt must be at most ${MAX_CHAT_PROMPT_CHARS.toLocaleString("en-US")} characters.`
              );
              return;
            }
            setChatThreadPrompt(tenant.chatId, tenant.threadId, prompt);
            await sendRichReply(
              ctx,
              `Custom prompt set for ${scopeLabel(tenant.threadId)}. It now replaces the personality selected in the panel here.`
            );
          },
        },
        {
          name: "get_prompt",
          description: "Show the custom prompt for this chat or topic",
          handler: async (ctx, tenant) => {
            const prompt = getChatThreadPrompt(tenant.chatId, tenant.threadId);
            if (!prompt) {
              await sendRichReply(
                ctx,
                `No custom prompt is set for ${scopeLabel(tenant.threadId)}. The panel personality is active.`
              );
              return;
            }
            await ctx.reply(prompt, {
              message_thread_id: tenant.threadId,
              reply_to_message_id: ctx.message?.message_id,
            });
          },
        },
        {
          name: "reset_prompt",
          description: "Reset the custom prompt for this chat or topic",
          handler: async (ctx, tenant) => {
            const removed = resetChatThreadPrompt(tenant.chatId, tenant.threadId);
            await sendRichReply(
              ctx,
              removed
                ? `Custom prompt reset for ${scopeLabel(tenant.threadId)}. The panel personality is active again.`
                : `No custom prompt was set for ${scopeLabel(tenant.threadId)}. The panel personality is already active.`
            );
          },
        },
      ],
    };
  },
};
