-- =====================================================================
-- Tax Categories + Per-Location Overrides
-- Date: 2026-07-29
-- Database: itap_pos_dev (Aurora Postgres, ca-central-1)
--
-- Purpose:
--   - Merchants split products into tax categories (Standard, Zero-rated
--     food, Reduced 5%, etc.) — needed for UK VAT and any regime with
--     product-level tax rules.
--   - Per-location overrides let one tenant with stores across US states
--     charge each store's local rate for the same category.
--
-- Backwards compatibility:
--   - Product.tax_category_id is nullable → existing products fall back
--     to the tenant's settings.tax_rate (single-rate mode). Nothing
--     breaks until a merchant creates a category.
--
-- HOW TO APPLY:
--   1. psql to Aurora from EC2
--   2. \i this file
--   3. Verify: \dt tax_categories, location_tax_rates
--   4. On EC2: pull schema.prisma changes, run `npx prisma generate`
--
-- ROLLBACK: see bottom.
-- =====================================================================

BEGIN;

-- ── Table: tax_categories ────────────────────────────────────────────
CREATE TABLE tax_categories (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name          VARCHAR(100) NOT NULL,
  rate_percent  NUMERIC(5, 2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  description   TEXT,

  is_default    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, name)
);

-- One default per tenant. Partial unique lets multiple non-defaults exist.
CREATE UNIQUE INDEX idx_tax_categories_one_default_per_tenant
  ON tax_categories (tenant_id)
  WHERE is_default = TRUE;

CREATE INDEX idx_tax_categories_tenant ON tax_categories (tenant_id, is_active);

-- ── Table: location_tax_rates (per-location override) ────────────────
CREATE TABLE location_tax_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id     UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  tax_category_id UUID NOT NULL REFERENCES tax_categories(id) ON DELETE CASCADE,

  rate_percent    NUMERIC(5, 2) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (location_id, tax_category_id)
);

CREATE INDEX idx_location_tax_rates_location ON location_tax_rates (location_id);
CREATE INDEX idx_location_tax_rates_category ON location_tax_rates (tax_category_id);

-- ── Product FK — nullable, backward compat ───────────────────────────
ALTER TABLE products
  ADD COLUMN tax_category_id UUID REFERENCES tax_categories(id) ON DELETE SET NULL;

CREATE INDEX idx_products_tax_category ON products (tax_category_id)
  WHERE tax_category_id IS NOT NULL;

COMMIT;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- BEGIN;
--   ALTER TABLE products DROP COLUMN IF EXISTS tax_category_id;
--   DROP TABLE IF EXISTS location_tax_rates;
--   DROP TABLE IF EXISTS tax_categories;
-- COMMIT;
