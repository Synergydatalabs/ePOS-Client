-- ============================================================================
-- Supplier product variants — Phase D #70
-- Date: 2026-07-30
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. supplier_products.variant_axes  — text[] with axis names
--                                        (empty = simple product, no variants)
--   2. supplier_product_variants table  — one row per variant combination.
--                                         All price/stock fields nullable —
--                                         null = inherit from parent product.
--   3. Partial unique index on (product_id, sku) WHERE sku IS NOT NULL
--   4. purchase_order_items.variant_id + variant snapshot fields
--
-- Idempotent — every ADD COLUMN / CREATE TABLE / CREATE INDEX guarded.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. supplier_products.variant_axes
-- ---------------------------------------------------------------------------

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS variant_axes TEXT[] NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- 2. supplier_product_variants table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_product_variants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            UUID NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,

  display_name          VARCHAR(255) NOT NULL,
  attributes            JSONB NOT NULL,

  sku                   VARCHAR(64),
  barcode               VARCHAR(64),

  -- Overrides. NULL = inherit from parent product (see SupplierProduct fields).
  wholesale_price_cents INT,
  retail_price_cents    INT,
  min_order_qty         INT,
  step_qty              INT,
  track_inventory       BOOLEAN NOT NULL DEFAULT false,
  stock_level           INT,
  low_stock_threshold   INT,

  image_data_url        TEXT,

  is_active             BOOLEAN NOT NULL DEFAULT true,
  sort_order            INT NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Sanity — same constraints as parent product, applied to overrides
  -- when they're set.
  CONSTRAINT spv_wholesale_nonneg   CHECK (wholesale_price_cents IS NULL OR wholesale_price_cents >= 0),
  CONSTRAINT spv_retail_nonneg      CHECK (retail_price_cents    IS NULL OR retail_price_cents    >= 0),
  CONSTRAINT spv_min_order_positive CHECK (min_order_qty         IS NULL OR min_order_qty         >= 1),
  CONSTRAINT spv_step_positive      CHECK (step_qty              IS NULL OR step_qty              >= 1),
  CONSTRAINT spv_stock_nonneg       CHECK (stock_level           IS NULL OR stock_level           >= 0)
);

CREATE INDEX IF NOT EXISTS idx_spv_product_active
  ON supplier_product_variants(product_id, is_active);

-- SKU unique per PRODUCT when set (nullable variants without SKUs are fine).
-- Partial index because Prisma can't express "unique WHERE NOT NULL".
CREATE UNIQUE INDEX IF NOT EXISTS uniq_spv_product_sku_when_set
  ON supplier_product_variants(product_id, sku)
  WHERE sku IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. PO line item — variant reference + snapshot fields
-- ---------------------------------------------------------------------------

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS variant_id              UUID REFERENCES supplier_product_variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS variant_display_name    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS variant_attributes      JSONB;

CREATE INDEX IF NOT EXISTS idx_poi_variant
  ON purchase_order_items(variant_id)
  WHERE variant_id IS NOT NULL;

COMMIT;
