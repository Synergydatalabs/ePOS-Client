-- ============================================================================
-- Supplier Catalog — Phase B schema (products, categories, images)
-- Date: 2026-07-30
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. supplier_product_categories — supplier's own taxonomy (chocolates,
--      cheese, packaging, etc.)
--   2. supplier_products           — the catalog itself
--   3. supplier_product_images     — one row per image; separate so we can
--      list products without loading base64 image blobs every time
--
-- Idempotent — every CREATE uses IF NOT EXISTS.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. supplier_product_categories
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_product_categories (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name                VARCHAR(100) NOT NULL,
  description         VARCHAR(500),
  sort_order          INT NOT NULL DEFAULT 0,
  is_active           BOOLEAN NOT NULL DEFAULT true,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (supplier_tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_supplier_product_categories_tenant_active
  ON supplier_product_categories(supplier_tenant_id, is_active);

-- ---------------------------------------------------------------------------
-- 2. supplier_products
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_products (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id           UUID REFERENCES supplier_product_categories(id) ON DELETE SET NULL,

  sku                   VARCHAR(64),
  barcode               VARCHAR(64),

  name                  VARCHAR(255) NOT NULL,
  description           TEXT,

  unit_label            VARCHAR(50) NOT NULL DEFAULT 'unit',

  wholesale_price_cents INT NOT NULL,
  retail_price_cents    INT,

  min_order_qty         INT NOT NULL DEFAULT 1,
  step_qty              INT NOT NULL DEFAULT 1,

  track_inventory       BOOLEAN NOT NULL DEFAULT false,
  stock_level           INT,
  low_stock_threshold   INT,

  lead_time_days        INT,

  is_public             BOOLEAN NOT NULL DEFAULT false,
  is_active             BOOLEAN NOT NULL DEFAULT true,

  sort_order            INT NOT NULL DEFAULT 0,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Sanity constraints. Wholesale must be ≥ 0 (allowing 0 for free samples);
  -- min_order_qty and step_qty must be ≥ 1 (a value below 1 makes no sense).
  CONSTRAINT sp_wholesale_nonneg   CHECK (wholesale_price_cents >= 0),
  CONSTRAINT sp_min_order_positive CHECK (min_order_qty >= 1),
  CONSTRAINT sp_step_positive      CHECK (step_qty >= 1)
);

CREATE INDEX IF NOT EXISTS idx_supplier_products_tenant_active
  ON supplier_products(supplier_tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_supplier_products_tenant_category
  ON supplier_products(supplier_tenant_id, category_id);

CREATE INDEX IF NOT EXISTS idx_supplier_products_tenant_public
  ON supplier_products(supplier_tenant_id, is_public)
  WHERE is_public = true;

-- SKU is unique per supplier WHEN SET. Prisma can't express "unique where
-- not null" so we do it here as a partial unique index — catches accidental
-- duplicates on bulk import without blocking null-SKU rows.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_supplier_products_sku_when_set
  ON supplier_products(supplier_tenant_id, sku)
  WHERE sku IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. supplier_product_images
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_product_images (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES supplier_products(id) ON DELETE CASCADE,

  data_url    TEXT NOT NULL,
  alt_text    VARCHAR(200),
  sort_order  INT NOT NULL DEFAULT 0,
  is_primary  BOOLEAN NOT NULL DEFAULT false,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_product_images_product_sort
  ON supplier_product_images(product_id, sort_order);

-- Only one primary image per product. Partial unique index — enforces the
-- "exactly one primary" rule without preventing all-non-primary state
-- (which is fine while the supplier is still uploading).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_supplier_product_images_primary
  ON supplier_product_images(product_id)
  WHERE is_primary = true;

COMMIT;
