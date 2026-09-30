-- ============================================================================
-- Auto-reorder from par levels — Phase D #77
-- Date: 2026-07-31
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. Ingredient columns: auto-reorder qty, preferred marketplace supplier,
--      preferred supplier product, enabled flag, and a cooldown timestamp
--      to prevent PO spam.
--   2. PurchaseOrder column: auto_generated — flags rows the auto-reorder
--      scanner submitted (as opposed to a merchant manually placing them).
--      Used to badge the row in the merchant PO list.
--   3. FK constraints keep the preferred-supplier links honest, but use
--      SET NULL so deleting a supplier / product only clears the pointer
--      instead of orphaning the ingredient row.
--
-- Existing `low_stock_threshold` on ingredients is REUSED as the par level.
-- No need for a duplicate `par_level` column — the concept is identical
-- (below-threshold = reorder trigger).
--
-- Idempotent — every DDL guarded with IF NOT EXISTS.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Ingredient columns
-- ---------------------------------------------------------------------------

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS reorder_qty DECIMAL(10, 3);

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS preferred_supplier_tenant_id UUID;

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS preferred_supplier_product_id UUID;

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS auto_reorder_enabled BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS last_auto_reorder_at TIMESTAMPTZ;

-- FKs — SET NULL on delete so a supplier / product removal doesn't cascade
-- into an ingredient hard-delete. Guarded because IF NOT EXISTS is not
-- supported for ADD CONSTRAINT.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ingredients_preferred_supplier_tenant_id_fkey'
  ) THEN
    ALTER TABLE ingredients
      ADD CONSTRAINT ingredients_preferred_supplier_tenant_id_fkey
      FOREIGN KEY (preferred_supplier_tenant_id) REFERENCES tenants(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ingredients_preferred_supplier_product_id_fkey'
  ) THEN
    ALTER TABLE ingredients
      ADD CONSTRAINT ingredients_preferred_supplier_product_id_fkey
      FOREIGN KEY (preferred_supplier_product_id) REFERENCES supplier_products(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Partial index: only rows that are actually eligible for auto-reorder.
-- The evaluator scans this a lot; a partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_ingredients_auto_reorder_enabled
  ON ingredients(tenant_id, auto_reorder_enabled)
  WHERE auto_reorder_enabled = true;

-- ---------------------------------------------------------------------------
-- 2. Purchase orders — mark rows that were auto-generated
-- ---------------------------------------------------------------------------

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_po_auto_generated
  ON purchase_orders(merchant_tenant_id, auto_generated)
  WHERE auto_generated = true;

COMMIT;
