-- ============================================================================
-- Purchase Orders — Phase B schema
-- Date: 2026-07-30
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. Enum: PurchaseOrderStatus (CamelCase, matches Prisma default)
--   2. purchase_orders       — one row per PO between a merchant + supplier
--   3. purchase_order_items  — snapshotted line items (name/SKU/price frozen)
--
-- Design notes:
--   - No DRAFT state; the merchant cart lives in localStorage until submit.
--   - PO number is unique per SUPPLIER (partial unique index — merchants
--     never see PO numbers cross-supplier so no collision risk).
--   - product_id on the line item is nullable + SET NULL on delete: PO
--     history survives even if the supplier deletes/renames the product.
--   - taxCents defaults 0. Wholesale-B2B tax computation lands later.
--
-- Idempotent — every CREATE / ALTER guarded with IF NOT EXISTS or a DO block.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enum
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PurchaseOrderStatus') THEN
    CREATE TYPE "PurchaseOrderStatus" AS ENUM (
      'SUBMITTED',
      'ACKNOWLEDGED',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. purchase_orders
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  supplier_tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  merchant_tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  merchant_location_id        UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  relationship_id             UUID REFERENCES supplier_merchant_relationships(id) ON DELETE SET NULL,

  po_number                   VARCHAR(30) NOT NULL,

  status                      "PurchaseOrderStatus" NOT NULL DEFAULT 'SUBMITTED',

  currency                    VARCHAR(3) NOT NULL DEFAULT 'CAD',
  subtotal_cents              INT NOT NULL,
  tax_cents                   INT NOT NULL DEFAULT 0,
  total_cents                 INT NOT NULL,

  shipping_address            JSONB NOT NULL,

  notes_to_supplier           TEXT,
  notes_from_supplier         TEXT,

  shipment_carrier            VARCHAR(100),
  shipment_tracking_ref       VARCHAR(200),
  expected_delivery_at        TIMESTAMPTZ,

  cancelled_by_membership_id  UUID REFERENCES memberships(id) ON DELETE SET NULL,
  cancellation_reason         TEXT,

  submitted_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at             TIMESTAMPTZ,
  shipped_at                  TIMESTAMPTZ,
  delivered_at                TIMESTAMPTZ,
  cancelled_at                TIMESTAMPTZ,

  created_by_membership_id    UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Sanity constraints. Prices non-negative; totals must add up.
  CONSTRAINT po_subtotal_nonneg CHECK (subtotal_cents >= 0),
  CONSTRAINT po_tax_nonneg      CHECK (tax_cents >= 0),
  CONSTRAINT po_total_nonneg    CHECK (total_cents >= 0),
  CONSTRAINT po_total_matches   CHECK (total_cents = subtotal_cents + tax_cents)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_status
  ON purchase_orders(supplier_tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_merchant_status
  ON purchase_orders(merchant_tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_merchant_location
  ON purchase_orders(merchant_location_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_submitted_at_desc
  ON purchase_orders(submitted_at DESC);

-- PO number is unique per supplier (each supplier has their own PO series).
-- Partial isn't needed since po_number is NOT NULL — full unique index is fine.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_purchase_orders_supplier_po_number
  ON purchase_orders(supplier_tenant_id, po_number);

-- ---------------------------------------------------------------------------
-- 3. purchase_order_items
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES supplier_products(id) ON DELETE SET NULL,

  -- Frozen snapshot at submit time — never rewritten if the underlying
  -- product changes. Product name is NOT NULL because we always have it.
  product_sku       VARCHAR(64),
  product_name      VARCHAR(255) NOT NULL,
  unit_label        VARCHAR(50) NOT NULL,
  unit_price_cents  INT NOT NULL,

  qty               INT NOT NULL,
  line_total_cents  INT NOT NULL,

  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT poi_qty_positive       CHECK (qty > 0),
  CONSTRAINT poi_unit_price_nonneg  CHECK (unit_price_cents >= 0),
  CONSTRAINT poi_line_total_matches CHECK (line_total_cents = qty * unit_price_cents)
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_po
  ON purchase_order_items(purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_purchase_order_items_product
  ON purchase_order_items(product_id);

COMMIT;
