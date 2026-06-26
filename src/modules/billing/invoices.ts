import type { LabeledPrice } from "grammy/types";
import type { TokenPack } from "./env.js";

type ReadOnlyRecord = Readonly<Record<string, unknown>>;

/** Minimal subset of grammy's Api needed to create invoice links. */
export interface InvoiceApi {
  createInvoiceLink: (
    title: string,
    description: string,
    payload: string,
    provider_token: string,
    currency: string,
    prices: LabeledPrice[],
    other?: Record<string, unknown>
  ) => Promise<string>;
}

export interface InvoiceConfig {
  currency: string;
  title: string;
  description: string;
  subscriptionStars: number;
  subscriptionPeriodSeconds: number;
}

export const SUB_PAYLOAD_PREFIX = "skye:sub:";
export const PACK_PAYLOAD_PREFIX = "skye:pack:";

export function subPayload(userId: number): string {
  return `${SUB_PAYLOAD_PREFIX}${userId}`;
}

export function packPayload(userId: number, packId: string): string {
  return `${PACK_PAYLOAD_PREFIX}${packId}:${userId}`;
}

export async function createSubscriptionInvoiceLink(
  api: InvoiceApi,
  cfg: InvoiceConfig,
  userId: number
): Promise<string> {
  return api.createInvoiceLink(
    cfg.title,
    cfg.description,
    subPayload(userId),
    "", // Telegram Stars payments use an empty provider_token
    cfg.currency,
    [{ label: `${cfg.title} (30 days)`, amount: cfg.subscriptionStars }],
    { subscription_period: cfg.subscriptionPeriodSeconds }
  );
}

export async function createPackInvoiceLink(
  api: InvoiceApi,
  cfg: InvoiceConfig,
  userId: number,
  pack: TokenPack
): Promise<string> {
  return api.createInvoiceLink(
    cfg.title,
    `${pack.name} — adds ${pack.tokens.toLocaleString("en-US")} tokens. Only usable with an active ${cfg.title} subscription.`,
    packPayload(userId, pack.id),
    "",
    cfg.currency,
    [{ label: pack.name, amount: pack.stars }]
  );
}

/** Decode a successful-payment invoice payload back into its kind + ids. */
export function decodePayload(
  payload: string
):
  | { kind: "subscription"; userId: number }
  | { kind: "pack"; userId: number; packId: string }
  | null {
  if (payload.startsWith(SUB_PAYLOAD_PREFIX)) {
    const userId = Number(payload.slice(SUB_PAYLOAD_PREFIX.length));
    return Number.isFinite(userId) ? { kind: "subscription", userId } : null;
  }
  if (payload.startsWith(PACK_PAYLOAD_PREFIX)) {
    const rest = payload.slice(PACK_PAYLOAD_PREFIX.length);
    const sep = rest.lastIndexOf(":");
    if (sep <= 0) return null;
    const packId = rest.slice(0, sep);
    const userId = Number(rest.slice(sep + 1));
    if (!Number.isFinite(userId)) return null;
    return { kind: "pack", userId, packId };
  }
  return null;
}

/** Build an InvoiceConfig from the parsed environment. */
export function decodeInvoiceConfig(config: ReadOnlyRecord): InvoiceConfig {
  return {
    currency: String(config.BILLING_CURRENCY ?? "XTR"),
    title: String(config.BILLING_TITLE ?? "Skye Plus"),
    description: String(config.BILLING_DESCRIPTION ?? ""),
    subscriptionStars: Number(config.BILLING_SUBSCRIPTION_STARS ?? 1899),
    subscriptionPeriodSeconds: Number(
      config.BILLING_SUBSCRIPTION_PERIOD_SECONDS ?? 2_592_000
    ),
  };
}