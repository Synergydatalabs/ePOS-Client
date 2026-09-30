-- =============================================================================
-- Phase F #2 (2026-08-27) — Supplier-issued invoices.
--
-- Two new tables:
--   supplier_invoices        (one row per invoice a supplier sends to an
--                             external customer email)
--   supplier_invoice_items   (line items on that invoice; snapshotted from
--                             supplier_products so deleting a product doesn't
--                             break historical invoices)
--
-- Kept as separate tables from purchase_orders because a PurchaseOrder's
-- merchant_tenant_id + merchant_location_id are NOT NULL, and making them
-- nullable would cascade type changes through dozens of existing queries.
--
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Zero downtime: only creates new tables, no touching of existing ones.
--
-- To apply on EC2 (PowerShell):
--     psql "$env:DATABASE_URL" -f phase-f-supplier-invoices.sql
--
-- After applying: `npx prisma generate` in tap-app (per project convention —
-- schema.prisma is already updated to match).
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id                          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id          uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  invoice_number              varchar(30)  NOT NULL,
  status                      varchar(20)  NOT NULL DEFAULT 'SENT',

  -- Customer (external — not a hub tenant, just an email address)
  customer_name               varchar(255) NOT NULL,
  customer_email              varchar(255) NOT NULL,
  customer_phone              varchar(30),
  customer_company            varchar(255),
  customer_address            text,

  -- Money (cents; MVP does zero-tax by default, supplier can enter a lump sum)
  currency                    varchar(3)   NOT NULL DEFAULT 'CAD',
  subtotal_cents              integer      NOT NULL,
  tax_cents                   integer      NOT NULL DEFAULT 0,
  total_cents                 integer      NOT NULL,

  notes                       text,

  -- Payment status (mirrors PurchaseOrder payment fields — same webhook path)
  payment_status              varchar(20)  NOT NULL DEFAULT 'UNPAID',
  payment_link_url            varchar(1000),
  payment_link_ref            varchar(255),
  paid_at                     timestamptz,
  paid_method                 varchar(60),
  amount_paid_cents           integer,

  -- Lifecycle
  sent_at                     timestamptz  NOT NULL DEFAULT NOW(),
  email_sent_at               timestamptz,
  email_failed_reason         text,
  cancelled_at                timestamptz,
  cancelled_by_membership_id  uuid,
  cancellation_reason         text,

  -- Legal / T&C (Phase 3 populates)
  terms_version               varchar(40),

  created_at                  timestamptz  NOT NULL DEFAULT NOW(),
  updated_at                  timestamptz  NOT NULL DEFAULT NOW(),
  created_by_membership_id    uuid,

  -- Invoice number is unique per supplier.
  CONSTRAINT supplier_invoices_number_unique
    UNIQUE (supplier_tenant_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status
  ON supplier_invoices (supplier_tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_sent_at
  ON supplier_invoices (supplier_tenant_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_customer_email
  ON supplier_invoices (customer_email);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_payment_ref
  ON supplier_invoices (payment_link_ref);


CREATE TABLE IF NOT EXISTS supplier_invoice_items (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id            uuid         NOT NULL REFERENCES supplier_invoices(id) ON DELETE CASCADE,

  -- Optional back-ref — SET NULL if the source product is later deleted.
  product_id            uuid         REFERENCES supplier_products(id) ON DELETE SET NULL,

  -- Frozen snapshot at invoice time.
  product_name          varchar(255) NOT NULL,
  product_description   text,
  unit_label            varchar(50)  NOT NULL DEFAULT 'unit',

  quantity              integer      NOT NULL DEFAULT 1,
  unit_price_cents      integer      NOT NULL,
  line_total_cents      integer      NOT NULL,

  sort_order            integer      NOT NULL DEFAULT 0,

  created_at            timestamptz  NOT NULL DEFAULT NOW(),
  updated_at            timestamptz  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_items_invoice
  ON supplier_invoice_items (invoice_id);

CREATE INDEX IF NOT EXISTS idx_supplier_invoice_items_product
  ON supplier_invoice_items (product_id);

-- updated_at trigger on both tables. If a shared trigger function already
-- exists in the schema (from earlier phases), this reuses it; otherwise
-- create one now.
CREATE OR REPLACE FUNCTION set_updated_at_now() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_supplier_invoices_updated_at ON supplier_invoices;
CREATE TRIGGER trg_supplier_invoices_updated_at
  BEFORE UPDATE ON supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

DROP TRIGGER IF EXISTS trg_supplier_invoice_items_updated_at ON supplier_invoice_items;
CREATE TRIGGER trg_supplier_invoice_items_updated_at
  BEFORE UPDATE ON supplier_invoice_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_now();

COMMIT;

-- Verify:
-- SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'supplier_invoice%';
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--   WHERE table_name = 'supplier_invoices' ORDER BY ordinal_position;
