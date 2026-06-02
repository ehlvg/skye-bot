import { Bot, Context, InlineKeyboard } from "grammy";
import { WEBAPP_URL } from "./config.js";

type WizardState = "api_key" | "base_url";
const wizardState = new Map<number, WizardState>();

export function isInWizard(chatId: number): boolean {
  return wizardState.has(chatId);
}

export function registerConfigHandlers(bot: Bot): void {
  bot.command("config", async (ctx) => {
    await ctx.reply("Open the settings panel to configure your bot:", {
      reply_markup: new InlineKeyboard().webApp("Open Settings", WEBAPP_URL),
    });
  });

  bot.on("callback_query:data", async (ctx, next) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("cfg:")) return next();
    await ctx.answerCallbackQuery();
    await next();
  });
}

export async function handleWizardInput(ctx: Context): Promise<boolean> {
  const chatId = ctx.chat?.id;
  if (!chatId) return false;

  const state = wizardState.get(chatId);
  if (!state) return false;

  wizardState.delete(chatId);
  return false;
}
