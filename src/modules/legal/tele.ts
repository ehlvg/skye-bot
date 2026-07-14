import { InlineKeyboard, type Context as GrammyContext, type NextFunction } from "grammy";
import type { TelegramCommand, TelegramHandler } from "../../core/module.js";
import type { TenantContext } from "../../core/tenant.js";
import type { LegalService } from "./service.js";
import type { LegalEnv } from "./env.js";
import { sendRichReply } from "../telegram/helpers.js";

export interface LegalDeps {
  legal: LegalService;
  cfg: Pick<
    LegalEnv,
    | "LEGAL_TERMS_URL"
    | "LEGAL_PRIVACY_URL"
    | "LEGAL_SUPPORT_USERNAME"
    | "LEGAL_DEVELOPER_NAME"
    | "LEGAL_DEVELOPER_EMAIL"
  >;
}

export function buildLegalCommands(deps: LegalDeps): TelegramCommand[] {
  const { cfg } = deps;

  return [
    {
      name: "terms",
      description: "Terms of Service",
      public: true,
      handler: async (ctx) => {
        await ctx.reply("📄 Terms of Service", {
          reply_markup: new InlineKeyboard().url("Open Terms", cfg.LEGAL_TERMS_URL),
        });
      },
    },
    {
      name: "privacy",
      description: "Privacy Policy",
      public: true,
      handler: async (ctx) => {
        await ctx.reply("🔐 Privacy Policy", {
          reply_markup: new InlineKeyboard().url("Open Privacy Policy", cfg.LEGAL_PRIVACY_URL),
        });
      },
    },
    {
      name: "paysupport",
      description: "Payment support contact",
      public: true,
      handler: async (ctx) => {
        const md = [
          "## Payment support",
          "",
          `Problems with a Stars payment, refund, or subscription? Reach out:`,
          "",
          `- Telegram: ${cfg.LEGAL_SUPPORT_USERNAME}`,
          `- Email: ${cfg.LEGAL_DEVELOPER_EMAIL}`,
          "",
          "Include your Telegram user id so we can find your account faster.",
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "developer_info",
      description: "Developer information",
      public: true,
      handler: async (ctx) => {
        const md = [
          "## Developer",
          "",
          `**${cfg.LEGAL_DEVELOPER_NAME}**`,
          "",
          `- Telegram: ${cfg.LEGAL_SUPPORT_USERNAME}`,
          `- Email: ${cfg.LEGAL_DEVELOPER_EMAIL}`,
        ].join("\n");
        await sendRichReply(ctx, md);
      },
    },
    {
      name: "delete_my_data",
      description: "Delete all your data from Skye",
      public: true,
      handler: async (ctx) => {
        if (ctx.chat?.type !== "private") {
          await sendRichReply(
            ctx,
            "For your safety, /delete_my_data only works in a private chat with Skye. Open me in DMs to proceed."
          );
          return;
        }
        const md = [
          "## Delete your data",
          "",
          "This will **permanently** erase everything Skye stores about you:",
          "",
          "- Your settings, system prompt, and model choice",
          "- Your connected MCP servers",
          "- Your subscription, token balance, and billing history",
          "- Your long-term memories",
          "- Your private conversation history and summaries",
          "- Your reminders",
          "- Your answer feedback",
          "- Your audit log entries",
          "",
          "_Shared group data is kept — it belongs to the group, not to you alone._",
          "",
          "This cannot be undone. Continue?",
        ].join("\n");
        await ctx.reply(md, {
          reply_markup: new InlineKeyboard()
            .text("Yes, delete everything", "legal:delete:confirm")
            .row()
            .text("Cancel", "legal:delete:cancel"),
        });
      },
    },
  ];
}

export function buildLegalHandlers(deps: LegalDeps): TelegramHandler[] {
  const onCallback: TelegramHandler = {
    on: "callback_query:data",
    order: 85,
    handler: async (ctx: GrammyContext, _tenant: TenantContext, next: NextFunction) => {
      const data = ctx.callbackQuery?.data ?? "";
      if (!data.startsWith("legal:")) return next();

      const userId = ctx.from?.id;
      if (!userId) {
        await ctx.answerCallbackQuery();
        return;
      }

      const action = data.slice("legal:".length);
      try {
        if (action === "delete:cancel") {
          await ctx.answerCallbackQuery("Cancelled.");
          await ctx.editMessageText("Data deletion cancelled. Nothing was erased.");
          return;
        }

        if (action === "delete:confirm") {
          await ctx.answerCallbackQuery("Erasing your data…");
          const summary = deps.legal.deleteUserData(userId);
          const total =
            summary.userConfigs +
            summary.userMcpServers +
            summary.userMcpInputs +
            summary.billingAccounts +
            summary.billingEvents +
            summary.memories +
            summary.chatSummaries +
            summary.conversationItems +
            summary.groupMessages +
            summary.chatConfigs +
            summary.reminders +
            summary.responseFeedback +
            summary.requestLogs;

          const md = [
            "✅ **Your data has been deleted.**",
            "",
            `Erased ${total} record(s) across Skye's database.`,
            "",
            "_This message is the only confirmation we keep. A fresh start — say hi anytime._",
          ].join("\n");
          await ctx.editMessageText(md);
          return;
        }
      } catch {
        await ctx.answerCallbackQuery("Something went wrong.");
        await ctx.editMessageText(
          "Couldn't complete data deletion. Please contact support via /paysupport."
        );
        return;
      }

      return next();
    },
  };

  return [onCallback];
}
