import { test, expect, describe, beforeEach } from "vitest";
import { BillingService } from "../service.js";
import { getDb } from "../../../core/db.js";

const baseQuota = 2_000_000;
const period = 2_592_000;

function newService(): BillingService {
  return new BillingService({ baseQuotaTokens: baseQuota, periodSeconds: period }, "sydney");
}

const USER = 4242;

beforeEach(() => {
  getDb().exec(
    "DELETE FROM billing_payments; DELETE FROM billing_invoices; DELETE FROM billing_accounts; DELETE FROM billing_events;"
  );
});

describe("BillingService.ensureAccount", () => {
  test("creates a default account for a new user", () => {
    const s = newService();
    const acc = s.getAccount(USER);
    expect(acc.userId).toBe(USER);
    expect(acc.modelId).toBe("sydney");
    expect(acc.subStatus).toBe("none");
    expect(s.hasActiveSub(acc)).toBe(false);
    expect(s.effectiveRemaining(acc)).toBe(0);
  });
});

describe("BillingService.recordSubscriptionPayment", () => {
  test("activates a subscription and resets base quota", () => {
    const s = newService();
    const acc = s.recordSubscriptionPayment(USER, {
      telegram_payment_charge_id: "chg-1",
      total_amount: 1899,
      subscription_expiration_date: Math.floor(Date.now() / 1000) + period,
      is_first_recurring: true,
      invoice_payload: "skye:sub:4242",
    });
    expect(acc.subStatus).toBe("active");
    expect(acc.lastChargeId).toBe("chg-1");
    expect(s.hasActiveSub(acc)).toBe(true);
    expect(s.effectiveRemaining(acc)).toBe(baseQuota);
  });

  test("renewal resets used tokens but keeps purchased packs", () => {
    const s = newService();
    s.recordSubscriptionPayment(USER, {
      telegram_payment_charge_id: "chg-1",
      total_amount: 1899,
      subscription_expiration_date: Math.floor(Date.now() / 1000) + period,
      is_first_recurring: true,
      invoice_payload: "skye:sub:4242",
    });
    // Buy a small pack and spend more than it holds, so base quota is touched.
    s.recordPackPurchase(USER, { id: "pack_small", name: "Tiny", tokens: 300 });
    s.charge(USER, 1000, 1000, 1);
    expect(s.getAccount(USER).baseUsedTokens).toBeGreaterThan(0);

    const renewed = s.recordSubscriptionPayment(USER, {
      telegram_payment_charge_id: "chg-2",
      total_amount: 1899,
      subscription_expiration_date: Math.floor(Date.now() / 1000) + period * 2,
      is_recurring: true,
      invoice_payload: "skye:sub:4242",
    });
    expect(renewed.subStatus).toBe("active");
    expect(renewed.baseUsedTokens).toBe(0);
    // Remaining packs survive a renewal…
    s.recordPackPurchase(USER, { id: "pack_keep", name: "Keep", tokens: 100 });
    expect(s.getAccount(USER).packsTokens).toBe(100);
    // …and an unspent renewal doesn't wipe them.
    const renewedAgain = s.recordSubscriptionPayment(USER, {
      telegram_payment_charge_id: "chg-3",
      total_amount: 1899,
      subscription_expiration_date: Math.floor(Date.now() / 1000) + period * 3,
      is_recurring: true,
      invoice_payload: "skye:sub:4242",
    });
    expect(renewedAgain.packsTokens).toBe(100);
  });
});

describe("BillingService.charge", () => {
  test("blocks without a subscription", () => {
    const s = newService();
    const r = s.charge(USER, 100, 100, 1);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no_subscription");
  });

  test("drains packs before base quota and applies multiplier", () => {
    const s = newService();
    s.recordSubscriptionPayment(USER, {
      telegram_payment_charge_id: "c",
      total_amount: 1899,
      subscription_expiration_date: Math.floor(Date.now() / 1000) + period,
      is_first_recurring: true,
      invoice_payload: "skye:sub:4242",
    });
    s.recordPackPurchase(USER, { id: "p", name: "p", tokens: 300 });

    // (100 + 100) * 1.5 = 300 -> entirely from packs.
    const r = s.charge(USER, 100, 100, 1.5);
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(300);
    const acc = s.getAccount(USER);
    expect(acc.packsTokens).toBe(0);
    expect(acc.baseUsedTokens).toBe(0);
  });

  test("spills remaining cost into base quota after packs run out", () => {
    const s = newService();
    s.recordSubscriptionPayment(USER, {
      telegram_payment_charge_id: "c",
      total_amount: 1899,
      subscription_expiration_date: Math.floor(Date.now() / 1000) + period,
      is_first_recurring: true,
      invoice_payload: "skye:sub:4242",
    });
    s.recordPackPurchase(USER, { id: "p", name: "p", tokens: 200 });

    // 1x multiplier, 500 tokens -> 200 from packs, 300 from base.
    const r = s.charge(USER, 250, 250, 1);
    expect(r.cost).toBe(500);
    const acc = s.getAccount(USER);
    expect(acc.packsTokens).toBe(0);
    expect(acc.baseUsedTokens).toBe(300);
  });

  test("rejects a charge larger than the remaining quota", () => {
    const s = newService();
    s.recordSubscriptionPayment(USER, {
      telegram_payment_charge_id: "c",
      total_amount: 1899,
      subscription_expiration_date: Math.floor(Date.now() / 1000) + period,
      invoice_payload: "legacy",
    });
    const result = s.charge(USER, baseQuota + 1, 0, 1);
    expect(result).toMatchObject({ ok: false, reason: "no_quota", remaining: baseQuota });
    expect(s.getAccount(USER).baseUsedTokens).toBe(0);
  });
});

describe("BillingService immutable invoices", () => {
  test("fulfills snapshotted pack terms once", () => {
    const s = newService();
    const invoice = s.issueInvoice({
      userId: USER,
      kind: "pack",
      productId: "small",
      title: "Small",
      currency: "XTR",
      amount: 100,
      tokens: 500,
      subscriptionPeriod: null,
    });
    const first = s.fulfillInvoice({
      userId: USER,
      invoiceId: invoice.id,
      currency: "XTR",
      amount: 100,
      chargeId: "pay-1",
    });
    const duplicate = s.fulfillInvoice({
      userId: USER,
      invoiceId: invoice.id,
      currency: "XTR",
      amount: 100,
      chargeId: "pay-1",
    });
    expect(first?.tokens).toBe(500);
    expect(duplicate?.id).toBe(invoice.id);
    expect(s.getAccount(USER).packsTokens).toBe(500);
  });

  test("rejects stale invoice amount and user mismatches", () => {
    const s = newService();
    const invoice = s.issueInvoice({
      userId: USER,
      kind: "pack",
      productId: "small",
      title: "Small",
      currency: "XTR",
      amount: 100,
      tokens: 500,
      subscriptionPeriod: null,
    });
    expect(s.validateInvoice(USER, invoice.id, "XTR", 99)).toBeNull();
    expect(s.validateInvoice(USER + 1, invoice.id, "XTR", 100)).toBeNull();
  });
});

describe("BillingService.reconcile", () => {
  test("lapses an expired subscription and zeroes packs", () => {
    const s = newService();
    s.recordSubscriptionPayment(USER, {
      telegram_payment_charge_id: "c",
      total_amount: 1899,
      subscription_expiration_date: Math.floor(Date.now() / 1000) - 10,
      is_first_recurring: true,
      invoice_payload: "skye:sub:4242",
    });
    s.recordPackPurchase(USER, { id: "p", name: "p", tokens: 1000 });
    const acc = s.getAccount(USER); // triggers reconcile
    expect(acc.subStatus).toBe("none");
    expect(acc.packsTokens).toBe(0);
    expect(s.effectiveRemaining(acc)).toBe(0);
  });
});

describe("BillingService.cancel / modelSelect", () => {
  test("markCancelled keeps access until expiry then lapses", () => {
    const s = newService();
    s.recordSubscriptionPayment(USER, {
      telegram_payment_charge_id: "c",
      total_amount: 1899,
      subscription_expiration_date: Math.floor(Date.now() / 1000) + period,
      is_first_recurring: true,
      invoice_payload: "skye:sub:4242",
    });
    s.markCancelled(USER);
    const acc = s.getAccount(USER);
    expect(acc.subStatus).toBe("cancelled");
    expect(s.hasActiveSub(acc)).toBe(true);
    expect(s.effectiveRemaining(acc)).toBeGreaterThan(0);
  });

  test("selectModel persists the choice", () => {
    const s = newService();
    s.selectModel(USER, "tokyo");
    expect(s.getAccount(USER).modelId).toBe("tokyo");
  });
});
