-- ============================================================================
-- Supplier product volume-tier pricing — Phase D #73
-- Date: 2026-07-30
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. supplier_product_price_tiers table  — one row per (product OR
--      variant, minQty) combination. XOR-constrained: exactly one of
--      product_id / variant_id is set.
--   2. UNIQUE (product_id, min_qty) and UNIQUE (variant_id, min_qty)
--      partial indexes — a supplier can't accidentally create two tiers
--      at the same minQty on the same row.
--
-- Resolution at order time (JS side, src/lib/supplier-price-tiers.ts):
--   sort tiers by min_qty desc, pick the first where min_qty <= qty.
--
-- Idempotent — every CREATE guarded.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS supplier_product_price_tiers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        UUID REFERENCES supplier_products(id) ON DELETE CASCADE,
  variant_id        UUID REFERENCES supplier_product_variants(id) ON DELETE CASCADE,

  min_qty           INT NOT NULL,
  unit_price_cents  INT NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- XOR: exactly one of product_id / variant_id is set. This is what
  -- keeps the model unambiguous — the same tier can't apply to both
  -- levels at once.
  CONSTRAINT sppt_xor_target CHECK (
    (product_id IS NOT NULL)::int + (variant_id IS NOT NULL)::int = 1
  ),
  CONSTRAINT sppt_min_qty_positive CHECK (min_qty >= 1),
  CONSTRAINT sppt_price_nonneg     CHECK (unit_price_cents >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sppt_product_min
  ON supplier_product_price_tiers(product_id, min_qty)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sppt_variant_min
  ON supplier_product_price_tiers(variant_id, min_qty)
  WHERE variant_id IS NOT NULL;

-- Partial unique indexes: no duplicate min_qty on the same product/variant.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sppt_product_min_qty
  ON supplier_product_price_tiers(product_id, min_qty)
  WHERE product_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_sppt_variant_min_qty
  ON supplier_product_price_tiers(variant_id, min_qty)
  WHERE variant_id IS NOT NULL;

COMMIT;
