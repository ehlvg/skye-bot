import type { BillingService } from "../billing/service.js";
import type { AdminService } from "../admin/service.js";

export interface AccessDeps {
  billing: BillingService;
  admin: AdminService;
}

export type AccessDecision =
  | { ok: true; reason: "admin" | "allowlist" | "subscription" }
  | { ok: false; reason: "banned" | "no_subscription"; message: string };

/**
 * Decide whether the caller may use Skye.
 *
 * Order:
 *   1. banned → denied
 *   2. admin → free, unlimited
 *   3. allowlist (chat or user) → free, unlimited
 *   4. active Skye Plus subscription on the speaking user → metered
 *   5. otherwise → prompt to subscribe
 *
 * Token quota is enforced separately in the chat loop (pre-check before each
 * LLM call); the gate only answers "can the user use the bot at all".
 */
export function checkAccess(deps: AccessDeps, chatId: number, userId?: number): AccessDecision {
  if (userId && deps.admin.isBanned(userId)) {
    return { ok: false, reason: "banned", message: "You've been banned from using this bot." };
  }
  if (userId && deps.admin.isAdmin(userId)) {
    return { ok: true, reason: "admin" };
  }
  if (deps.admin.isAllowed(chatId)) {
    return { ok: true, reason: "allowlist" };
  }
  if (userId && deps.admin.isAllowed(userId)) {
    return { ok: true, reason: "allowlist" };
  }
  if (userId) {
    const acc = deps.billing.getAccount(userId);
    if (deps.billing.hasActiveSub(acc)) {
      return { ok: true, reason: "subscription" };
    }
    return {
      ok: false,
      reason: "no_subscription",
      message:
        "Skye Plus is required to use this bot. Tap /plus to subscribe with Telegram Stars (1899 ⭐ / 30 days).",
    };
  }
  return {
    ok: false,
    reason: "no_subscription",
    message: "This chat isn't authorized. Ask an admin to /allow it.",
  };
}

/** Boolean shorthand used by the Telegram access gate. */
export function hasAccess(deps: AccessDeps, chatId: number, userId?: number): boolean {
  return checkAccess(deps, chatId, userId).ok;
}

export function hasMeteredAccess(deps: AccessDeps, userId?: number): boolean {
  if (!userId) return false;
  return deps.billing.hasActiveSub(deps.billing.getAccount(userId));
}
