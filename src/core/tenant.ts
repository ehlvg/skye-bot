import type { Context as GrammyContext } from "grammy";
import type { ValidatedInitData } from "../modules/panel/auth.js";

/**
 * Caller identity, derived per request.
 *
 * In Telegram surfaces it comes from `ctx.from` / `ctx.chat`.
 * In the panel HTTP surface it comes from validated initData.
 *
 * For DMs, `chatId === userId`. For groups they differ — `chatId` is the
 * conversation scope and `userId` the speaking individual.
 */
export interface TenantContext {
  /** Conversation scope. Used for per-chat data (memories, summaries). */
  chatId: number;
  /** Telegram chat type — private, group, supergroup, channel. */
  chatType: "private" | "group" | "supergroup" | "channel";
  /** Forum thread (topic) id, if any. */
  threadId?: number;
  /** Individual user. Used for per-user data (api key, mcp servers). */
  userId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
}

/** Build a TenantContext from a grammy update context. */
export function tenantFromGrammy(ctx: GrammyContext): TenantContext {
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat && !from) {
    throw new Error("Cannot derive tenant: ctx.chat is undefined");
  }
  if (!chat) {
    return {
      chatId: from!.id,
      chatType: "private",
      userId: from!.id,
      username: from!.username,
      firstName: from!.first_name,
      lastName: from!.last_name,
    };
  }
  return {
    chatId: chat.id,
    chatType: chat.type,
    threadId: ctx.message?.message_thread_id ?? undefined,
    userId: from?.id,
    username: from?.username,
    firstName: from?.first_name,
    lastName: from?.last_name,
  };
}

/**
 * Build a TenantContext from validated Telegram WebApp initData. In the panel
 * the chat scope equals the user (private DM with the bot).
 */
export function tenantFromInitData(init: ValidatedInitData): TenantContext {
  return {
    chatId: init.user.id,
    chatType: "private",
    userId: init.user.id,
    username: init.user.username,
    firstName: init.user.first_name,
    lastName: init.user.last_name,
  };
}

/**
 * Composite key for per-thread state inside a chat (some chats have topics).
 * Returns "chatId" or "chatId:threadId".
 */
export function threadKey(t: Pick<TenantContext, "chatId" | "threadId">): string {
  return t.threadId != null ? `${t.chatId}:${t.threadId}` : String(t.chatId);
}
