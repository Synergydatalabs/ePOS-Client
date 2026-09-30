-- ============================================================================
-- Phase I (2026-09-08) — Payment Links
--
-- A payment link is a reusable TEMPLATE that generates a SupplierInvoice
-- when a customer clicks it. One row per link (a product can have many
-- links — each with different pricing, qty, or partner attribution).
--
-- Flow:
--   1. Supplier creates a link in the portal → gets short URL hub.../l/<slug>
--   2. Partner puts the URL on their site
--   3. Customer clicks → lands on /l/<slug> checkout page
--   4. Customer enters email + accepts T&C → clicks Continue
--   5. Backend creates a SupplierInvoice from the link template
--   6. Redirects customer to /pay/invoice/<newInvoiceId> — existing pay
--      flow + processor (Stripe / Moneris) takes over from there
--
-- Every existing pay/webhook/reconciliation path (SupplierProcessor,
-- SupplierInvoice, terms_acceptances) is reused verbatim — the link is
-- just a template layer on top.
-- ============================================================================

CREATE TABLE IF NOT EXISTS supplier_payment_links (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id                  UUID        REFERENCES supplier_products(id) ON DELETE SET NULL,

  -- Human-readable identifier shown in the supplier's link list
  -- ("Partner A — Retail", "Referral Campaign Q4"). Not shown to customer.
  nickname                    VARCHAR(120) NOT NULL,

  -- URL slug. Short, URL-safe, unique across all suppliers so the public
  -- URL hub.synergydatalabs.com/l/<slug> is globally addressable.
  -- Format: 6-32 chars, [a-z0-9-], auto-generated on create.
  short_slug                  VARCHAR(48) NOT NULL,

  -- Payment mode: 'one_time' (single charge) or 'subscription' (recurring).
  -- For subscription, `interval` + `interval_count` describe cadence.
  mode                        VARCHAR(20) NOT NULL DEFAULT 'one_time',
  interval                    VARCHAR(20),        -- 'day' / 'week' / 'month' / 'year' (null for one_time)
  interval_count              INT         DEFAULT 1,

  -- Pricing snapshot. Amount overrides the product's default price for
  -- THIS link only — lets the supplier give partner A special pricing
  -- without changing the product's catalog price. Nullable = use the
  -- product's price at click time.
  unit_amount_cents           INT,
  currency                    VARCHAR(3)  NOT NULL DEFAULT 'CAD',

  -- Quantity behavior — three sources of truth, URL param always wins:
  --   1. If URL has ?qty=N → lock at N (server clamps to min/max)
  --   2. Otherwise if qty_locked=true → lock at qty_default
  --   3. Otherwise show stepper starting at qty_default with min/max limits
  qty_locked                  BOOLEAN     NOT NULL DEFAULT true,
  qty_default                 INT         NOT NULL DEFAULT 1,
  qty_min                     INT         NOT NULL DEFAULT 1,
  qty_max                     INT,        -- null = no upper cap

  -- Attribution — free-text, shown in reports. Suppliers use it to tell
  -- which partner/campaign a click came from ("widget_weekly_website",
  -- "email_promo_dec_2026").
  partner_ref                 VARCHAR(120),

  -- Optional partner branding: display name + logo URL that overrides
  -- the supplier's own branding on the checkout page. Lets the checkout
  -- feel co-branded with the partner (e.g. Widget Weekly logo top-left).
  partner_display_name        VARCHAR(255),
  partner_logo_url            VARCHAR(1000),

  -- Optional post-payment redirect back to partner's own "thank you" page.
  -- If null, customer stays on hub's default success screen.
  redirect_url                VARCHAR(1000),

  -- Lifecycle
  status                      VARCHAR(20) NOT NULL DEFAULT 'active',  -- 'active' | 'disabled' | 'expired'
  expires_at                  TIMESTAMP,
  max_uses                    INT,        -- null = unlimited
  current_uses                INT         NOT NULL DEFAULT 0,

  -- Customer info fields the checkout page will collect. All are always
  -- captured; the flags here decide whether they're REQUIRED. Email is
  -- always required — the invoice + receipt need it.
  require_name                BOOLEAN     NOT NULL DEFAULT true,
  require_phone               BOOLEAN     NOT NULL DEFAULT false,
  require_company             BOOLEAN     NOT NULL DEFAULT false,

  -- Free-text description shown on the checkout page under the product
  -- name. Nullable — falls back to the product's own description.
  description_override        TEXT,

  -- Audit
  created_by_membership_id    UUID,
  created_at                  TIMESTAMP   NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMP   NOT NULL DEFAULT now(),

  -- Slug must be unique across ALL suppliers so the public URL resolves
  -- to exactly one link. Enforced by the app on create with retry.
  CONSTRAINT supplier_payment_links_short_slug_key UNIQUE (short_slug),

  -- Guard rails on mode + interval combination
  CONSTRAINT chk_mode_valid CHECK (mode IN ('one_time', 'subscription')),
  CONSTRAINT chk_subscription_interval CHECK (
    (mode = 'one_time' AND interval IS NULL) OR
    (mode = 'subscription' AND interval IN ('day', 'week', 'month', 'year'))
  ),
  CONSTRAINT chk_status_valid CHECK (status IN ('active', 'disabled', 'expired')),
  CONSTRAINT chk_qty_bounds CHECK (
    qty_default >= qty_min
    AND (qty_max IS NULL OR qty_default <= qty_max)
    AND qty_min >= 1
  ),
  CONSTRAINT chk_currency_iso CHECK (char_length(currency) = 3)
);

-- Fast lookups
CREATE INDEX IF NOT EXISTS idx_supplier_payment_links_tenant_status
  ON supplier_payment_links (supplier_tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_supplier_payment_links_product
  ON supplier_payment_links (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supplier_payment_links_partner_ref
  ON supplier_payment_links (supplier_tenant_id, partner_ref) WHERE partner_ref IS NOT NULL;
-- Slug lookup is used every time a customer opens the pay page — critical
-- path. Already covered by the UNIQUE constraint's implicit btree index.


-- ============================================================================
-- Link → Invoice attribution
--
-- When a customer clicks a payment link, the invoice we generate stores a
-- pointer back to the source link. This lets the supplier answer:
--   • "How many invoices did partner A's link produce this month?"
--   • "What's the total GMV attributable to the Q4 email campaign?"
--
-- Nullable so pre-Phase-I invoices (or invoices created via the normal
-- portal invoice modal, not via a link) leave it empty.
-- ============================================================================

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS payment_link_id UUID
    REFERENCES supplier_payment_links(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_link_partner_ref VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_payment_link
  ON supplier_invoices (payment_link_id) WHERE payment_link_id IS NOT NULL;
