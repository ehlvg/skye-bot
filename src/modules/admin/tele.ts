import type { Context as GrammyContext } from "grammy";
import type { TelegramCommand } from "../../core/module.js";
import type { AdminService, AllowKind } from "./service.js";
import { sendRichReply } from "../telegram/helpers.js";

function kindFromId(id: number): AllowKind {
  return id < 0 ? "group" : "user";
}

/** Resolve a target id + kind, preferring a replied-to message, then an arg, then the current group. */
function resolveTarget(
  ctx: GrammyContext,
  arg: string | undefined
): { id: number; kind: AllowKind; source: string } | null {
  const reply =
    ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  if (reply?.from) {
    return { id: reply.from.id, kind: "user", source: `replied user (id ${reply.from.id})` };
  }
  if (arg) {
    const n = Number(arg.trim());
    if (!Number.isSafeInteger(n) || n === 0) return null;
    return { id: n, kind: kindFromId(n), source: `id ${n}` };
  }
  const chat = ctx.chat;
  if (chat && (chat.type === "group" || chat.type === "supergroup")) {
    return { id: chat.id, kind: "group", source: `this chat (id ${chat.id})` };
  }
  return null;
}

export function buildAdminCommands(admin: AdminService): TelegramCommand[] {
  const guard = (ctx: GrammyContext): boolean => {
    if (!admin.isAdmin(ctx.from?.id)) {
      void sendRichReply(ctx, "🚫 This command is only available to bot administrators.");
      return false;
    }
    return true;
  };

  const ownerGuard = (ctx: GrammyContext): boolean => {
    if (!admin.isOwner(ctx.from?.id)) {
      void sendRichReply(ctx, "🚫 Only the primary bot owner can manage administrators.");
      return false;
    }
    return true;
  };

  return [
    {
      name: "claim_owner",
      description: "Claim ownership during first-run setup",
      public: true,
      advertise: false,
      handler: async (ctx, tenant) => {
        if (!admin.ownerClaimRequired()) {
          await sendRichReply(ctx, "The bot already has a primary owner.");
          return;
        }
        if (ctx.chat?.type !== "private" || !tenant.userId) {
          await sendRichReply(ctx, "Run this command in a private chat with the bot.");
          return;
        }
        const token = (ctx.match?.toString() ?? "").trim();
        if (!token || !admin.claimOwner(tenant.userId, token)) {
          await sendRichReply(ctx, "Invalid or expired owner claim token.");
          return;
        }
        if (ctx.message?.message_id) {
          await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
        }
        await sendRichReply(
          ctx,
          "✅ **Ownership claimed.**\n\nYou are now the permanent primary administrator. The one-time token has been invalidated."
        );
      },
    },
    {
      name: "add_admin",
      description: "(owner) Add a bot administrator",
      public: true,
      handler: async (ctx, tenant) => {
        if (!ownerGuard(ctx)) return;
        const arg = (ctx.match?.toString() ?? "").trim() || undefined;
        const target = resolveTarget(ctx, arg);
        if (!target || target.kind !== "user" || target.id <= 0) {
          await sendRichReply(
            ctx,
            "Usage: /add_admin <user_id>, or reply to a user with /add_admin."
          );
          return;
        }
        const added = admin.addAdmin(target.id, tenant.userId!);
        await sendRichReply(
          ctx,
          added
            ? `✅ Added \`${target.id}\` as an administrator.`
            : "That user is already an administrator."
        );
      },
    },
    {
      name: "remove_admin",
      description: "(owner) Remove a bot administrator",
      public: true,
      handler: async (ctx) => {
        if (!ownerGuard(ctx)) return;
        const arg = (ctx.match?.toString() ?? "").trim() || undefined;
        const target = resolveTarget(ctx, arg);
        if (!target || target.kind !== "user" || target.id <= 0) {
          await sendRichReply(
            ctx,
            "Usage: /remove_admin <user_id>, or reply to a user with /remove_admin."
          );
          return;
        }
        const result = admin.removeAdmin(target.id);
        const message =
          result === "removed"
            ? `🗑 Removed \`${target.id}\` from administrators.`
            : result === "protected"
              ? "The primary owner and config-defined administrators cannot be removed here."
              : "That user is not a delegated administrator.";
        await sendRichReply(ctx, message);
      },
    },
    {
      name: "admins",
      description: "(admin) List bot administrators",
      public: true,
      handler: async (ctx) => {
        if (!guard(ctx)) return;
        const entries = admin.listAdmins();
        const lines = entries.map((entry) => {
          const source = entry.role === "owner" ? "primary owner" : `${entry.source} admin`;
          return `- \`${entry.userId}\` — ${source}`;
        });
        await sendRichReply(ctx, `## Administrators (${entries.length})\n\n${lines.join("\n")}`);
      },
    },
    {
      name: "allow",
      description: "(admin) Allow a user or chat to use Skye",
      public: true,
      handler: async (ctx, tenant) => {
        if (!guard(ctx)) return;
        const arg = (ctx.match?.toString() ?? "").trim() || undefined;
        const target = resolveTarget(ctx, arg);
        if (!target) {
          await sendRichReply(
            ctx,
            "Usage: reply to a user with /allow, run /allow <id> (negative = group), or run /allow inside a group to allowlist it."
          );
          return;
        }
        if (admin.isBanned(target.id)) admin.unban(target.id);
        const changed = admin.allow(target.id, target.kind, tenant.userId ?? 0);
        await sendRichReply(
          ctx,
          changed
            ? `✅ ${target.source} added to the allowlist (${target.kind}).`
            : `✅ ${target.source} is already allowlisted.`
        );
      },
    },
    {
      name: "disallow",
      description: "(admin) Remove a chat or user from the allowlist",
      public: true,
      handler: async (ctx) => {
        if (!guard(ctx)) return;
        const arg = (ctx.match?.toString() ?? "").trim() || undefined;
        const target = resolveTarget(ctx, arg);
        if (!target) {
          await sendRichReply(ctx, "Usage: /disallow <id>, or reply to a user with /disallow.");
          return;
        }
        const removed = admin.disallow(target.id);
        await sendRichReply(
          ctx,
          removed
            ? `🗑 Removed ${target.source} from the allowlist.`
            : "That id isn't in the allowlist."
        );
      },
    },
    {
      name: "allowed",
      description: "(admin) List allowlisted chats and users",
      public: true,
      handler: async (ctx) => {
        if (!guard(ctx)) return;
        const list = admin.listAllowed();
        if (list.length === 0) {
          await sendRichReply(ctx, "_No allowlisted chats or users yet._");
          return;
        }
        const lines = list.map(
          (e) => `- \`${e.targetId}\` (${e.kind})${e.note ? ` — ${e.note}` : ""}`
        );
        await sendRichReply(ctx, `## Allowlist (${list.length})\n\n${lines.join("\n")}`);
      },
    },
    {
      name: "ban",
      description: "(admin) Ban a user from using Skye",
      public: true,
      handler: async (ctx, tenant) => {
        if (!guard(ctx)) return;
        const reply =
          ctx.message && "reply_to_message" in ctx.message
            ? ctx.message.reply_to_message
            : undefined;
        const arg = (ctx.match?.toString() ?? "").trim() || undefined;
        let id: number | undefined;
        if (reply?.from) id = reply.from.id;
        else if (arg) {
          const n = Number(arg.trim());
          if (Number.isSafeInteger(n) && n > 0) id = n;
        }
        if (id === undefined) {
          await sendRichReply(ctx, "Usage: /ban <user_id>, or reply to a user with /ban.");
          return;
        }
        admin.disallow(id);
        const banned = admin.ban(id, tenant.userId ?? 0);
        await sendRichReply(
          ctx,
          banned
            ? `🚫 Banned \`${id}\`.`
            : "Administrators cannot be banned. Remove delegated access first."
        );
      },
    },
    {
      name: "unban",
      description: "(admin) Lift a ban",
      public: true,
      handler: async (ctx) => {
        if (!guard(ctx)) return;
        const arg = (ctx.match?.toString() ?? "").trim() || undefined;
        if (!arg) {
          await sendRichReply(ctx, "Usage: /unban <user_id>.");
          return;
        }
        const n = Number(arg.trim());
        if (!Number.isSafeInteger(n) || n <= 0) {
          await sendRichReply(ctx, "Invalid id.");
          return;
        }
        const ok = admin.unban(n);
        await sendRichReply(ctx, ok ? `✅ Unbanned \`${n}\`.` : "That user wasn't banned.");
      },
    },
  ];
}
