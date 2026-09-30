-- =============================================================================
-- Phase G #1 (2026-08-30) — subscription billing (Flavour A).
--
-- Flavour A design (per hub product decision):
--   - No card vaulting. Each recurring invoice is a fresh emailed pay link
--     the buyer clicks.
--   - The vendor picks "One-time" or "Subscription (monthly / annual)" on
--     the invoice form. Same UX as today plus one radio group at the top.
--   - Subscription record activates ONLY when the first invoice is paid.
--     Until then it sits as PENDING_ACTIVATION and is invisible to the cron.
--   - Cron scans daily for ACTIVE supplier_subscriptions whose nextBillingAt is
--     due, generates the next invoice (fresh number, fresh pay link, same
--     line items), sends the email, and advances nextBillingAt.
--   - Cancel: buyer clicks a signed link in any subscription email OR
--     vendor clicks Cancel in the supplier portal. Cancellation stops
--     future generation but doesn't touch already-sent invoices.
--
-- All fields keep the existing invoice snapshot shape so a subscription
-- can carry any line items the vendor typed (not tied to a catalog product).
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Product-level pricing mode. Optional in round 1 — vendor picks
--    on the invoice form regardless. Kept here so the marketplace flow can
--    read it in a later round (buyer-choice-at-checkout for public listings).
-- ---------------------------------------------------------------------------
ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS pricing_mode VARCHAR(30) NOT NULL DEFAULT 'ONE_TIME_ONLY',
  ADD COLUMN IF NOT EXISTS subscription_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS subscription_interval    VARCHAR(20);

COMMENT ON COLUMN supplier_products.pricing_mode IS
  'ONE_TIME_ONLY | SUBSCRIPTION_ONLY | BOTH. Determines what a marketplace buyer sees at checkout. Vendor-created invoices ignore this — the vendor picks per-invoice.';
COMMENT ON COLUMN supplier_products.subscription_price_cents IS
  'Price per billing period when sold as a subscription. Only meaningful when pricing_mode allows supplier_subscriptions.';
COMMENT ON COLUMN supplier_products.subscription_interval IS
  'MONTHLY | ANNUAL. Fixed at 1x per period (no "every 3 months" yet).';

-- ---------------------------------------------------------------------------
-- 2. Subscriptions table. One row per buyer-vendor subscription. Every
--    generated invoice links back here via supplier_invoices.subscription_id.
--    The snapshot columns (customer, line_items JSON) live here rather than
--    on the invoice because they must survive across many invoices — the
--    invoice snapshot is a copy of THIS row's snapshot at generation time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_subscriptions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Customer (external — same shape as invoices; may or may not be a hub user)
  customer_name         VARCHAR(255) NOT NULL,
  customer_email        VARCHAR(255) NOT NULL,
  customer_cc_emails    TEXT[]       NOT NULL DEFAULT '{}',
  customer_phone        VARCHAR(30),
  customer_company      VARCHAR(255),
  customer_address      TEXT,

  -- Snapshot line items — same JSON shape as a SupplierInvoiceItem, frozen
  -- at subscription creation. Each generated invoice is built from this.
  -- Kept as JSONB (not a child table) because these lines never change
  -- for a given subscription — plan upgrades are a NEW subscription.
  line_items            JSONB NOT NULL,

  -- Money snapshot
  currency              VARCHAR(3)   NOT NULL DEFAULT 'CAD',
  subtotal_cents        INTEGER      NOT NULL,
  tax_cents             INTEGER      NOT NULL DEFAULT 0,
  total_cents           INTEGER      NOT NULL,

  -- Schedule
  interval              VARCHAR(20)  NOT NULL, -- 'MONTHLY' | 'ANNUAL'
  interval_count        INTEGER      NOT NULL DEFAULT 1,

  -- Lifecycle state
  -- PENDING_ACTIVATION → first invoice sent, waiting for payment
  -- ACTIVE            → first invoice paid; cron will generate next
  -- PAST_DUE          → most recent invoice unpaid past dunning window
  -- CANCELLED         → buyer/vendor/system cancelled; no more invoices
  status                VARCHAR(20)  NOT NULL DEFAULT 'PENDING_ACTIVATION',

  -- Timing
  activated_at          TIMESTAMPTZ,          -- when first invoice was paid
  next_billing_at       TIMESTAMPTZ,          -- when the cron should generate the next invoice
  cancelled_at          TIMESTAMPTZ,
  cancelled_by          VARCHAR(20),          -- 'BUYER' | 'VENDOR' | 'SYSTEM_DUNNING'
  cancellation_reason   TEXT,

  -- Buyer-side cancel token. Public-URL signed capability so the buyer
  -- can cancel from any subscription email without logging in. Rotate
  -- on demand (regenerate to invalidate old links).
  cancel_token          VARCHAR(64)  NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),

  -- Audit
  created_by_membership_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  notes                 TEXT,
  metadata              JSONB,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cron query: WHERE status='ACTIVE' AND next_billing_at <= NOW()
CREATE INDEX IF NOT EXISTS supplier_subscriptions_due_idx
  ON supplier_subscriptions (status, next_billing_at);
-- Supplier portal list view
CREATE INDEX IF NOT EXISTS supplier_subscriptions_supplier_status_idx
  ON supplier_subscriptions (supplier_tenant_id, status, created_at DESC);
-- Buyer-facing lookup ("my supplier_subscriptions" by email)
CREATE INDEX IF NOT EXISTS supplier_subscriptions_customer_email_idx
  ON supplier_subscriptions (customer_email);
-- Public cancel-link resolution
CREATE UNIQUE INDEX IF NOT EXISTS supplier_subscriptions_cancel_token_key
  ON supplier_subscriptions (cancel_token);

COMMENT ON TABLE supplier_subscriptions IS
  'One row per recurring billing arrangement. Activates on first invoice paid; cron generates subsequent invoices from the frozen line-item snapshot. No card vaulting — each invoice needs a manual pay click (Flavour A).';

-- ---------------------------------------------------------------------------
-- 3. Wire invoices to supplier_subscriptions. Nullable — most invoices remain
--    one-off. When set, this invoice is a period of that subscription.
-- ---------------------------------------------------------------------------
ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS subscription_id            UUID REFERENCES supplier_subscriptions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subscription_period_start  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_period_end    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_sequence      INTEGER;

COMMENT ON COLUMN supplier_invoices.subscription_id IS
  'When set, this invoice is a period of that subscription. Nullable — one-off invoices leave it NULL.';
COMMENT ON COLUMN supplier_invoices.subscription_sequence IS
  '1-indexed period number within the subscription. Invoice #1 activates the sub; #2+ are recurring generations.';

CREATE INDEX IF NOT EXISTS supplier_invoices_subscription_idx
  ON supplier_invoices (subscription_id, subscription_sequence);

-- ---------------------------------------------------------------------------
-- 4. Reminder / dunning log. One row per email we sent about a
--    subscription invoice (payment reminder, past-due notice, cancellation
--    warning). Keeps us from double-sending on cron reruns and gives the
--    vendor a paper trail of what the buyer received.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_subscription_reminders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES supplier_subscriptions(id) ON DELETE CASCADE,
  invoice_id      UUID NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,
  kind           VARCHAR(40) NOT NULL, -- 'FIRST_SEND' | 'REMINDER_D3' | 'REMINDER_D7' | 'FINAL_D14' | 'CANCELLATION_NOTICE'
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  succeeded      BOOLEAN NOT NULL DEFAULT TRUE,
  error_reason   TEXT
);

CREATE INDEX IF NOT EXISTS supplier_subscription_reminders_sub_idx
  ON supplier_subscription_reminders (subscription_id, invoice_id, kind);

COMMENT ON TABLE supplier_subscription_reminders IS
  'One row per subscription-related email sent to the buyer. Cron reads this to skip already-sent reminders on the same invoice.';

COMMIT;

-- Verification: view the new columns / tables
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'supplier_subscriptions'
ORDER BY ordinal_position;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'supplier_invoices'
  AND column_name LIKE 'subscription%'
ORDER BY column_name;
