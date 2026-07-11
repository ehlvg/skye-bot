import type { Migration } from "../../core/module.js";

export const migrations: Migration[] = [
  {
    id: "001-init",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS billing_accounts (
          user_id                INTEGER PRIMARY KEY,
          model_id               TEXT    NOT NULL DEFAULT 'sydney',
          sub_status             TEXT    NOT NULL DEFAULT 'none',  -- none | active | cancelled
          sub_expires_at         INTEGER NOT NULL DEFAULT 0,        -- unix seconds
          sub_period_start       INTEGER NOT NULL DEFAULT 0,
          base_used_tokens       INTEGER NOT NULL DEFAULT 0,        -- used in current period
          packs_tokens           INTEGER NOT NULL DEFAULT 0,        -- spend-first, expire on lapse
          total_used_tokens      INTEGER NOT NULL DEFAULT 0,        -- lifetime
          last_charge_id         TEXT,
          created_at             TEXT    NOT NULL,
          updated_at             TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS billing_events (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id     INTEGER NOT NULL,
          type        TEXT    NOT NULL,  -- subscription_start | subscription_renew | subscription_cancel | subscription_lapse | pack_purchase | token_spend | model_select
          payload     TEXT,
          amount      INTEGER,
          created_at  TEXT    NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_billing_events_user ON billing_events(user_id, created_at);
      `);
    },
  },
  {
    id: "002-immutable-invoices",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS billing_invoices (
          id TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('subscription', 'pack')),
          product_id TEXT,
          title TEXT NOT NULL,
          currency TEXT NOT NULL,
          amount INTEGER NOT NULL,
          tokens INTEGER,
          subscription_period INTEGER,
          status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'paid', 'void')),
          created_at TEXT NOT NULL,
          paid_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_billing_invoices_user ON billing_invoices(user_id, created_at);
        CREATE TABLE IF NOT EXISTS billing_payments (
          telegram_payment_charge_id TEXT PRIMARY KEY,
          invoice_id TEXT NOT NULL,
          user_id INTEGER NOT NULL,
          currency TEXT NOT NULL,
          amount INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id)
        );
      `);
    },
  },
];
