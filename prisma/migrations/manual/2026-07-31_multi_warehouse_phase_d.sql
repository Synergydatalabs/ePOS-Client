-- ============================================================================
-- Multi-warehouse per supplier — Phase D #76
-- Date: 2026-07-31
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. supplier_warehouses — one row per fulfillment origin a supplier
--      operates from. Regional distributors typically have 2–4; a
--      single-location supplier just uses one.
--   2. purchase_orders.warehouse_id — nullable pointer. When null, PO
--      ships from the supplier's DEFAULT warehouse. Set explicitly when
--      the supplier picks one at acknowledgement.
--   3. Partial unique index guaranteeing at most ONE default warehouse
--      per supplier. Enforced at DB level so racing updates can't create
--      two defaults.
--
-- Idempotent — every DDL guarded with IF NOT EXISTS.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. supplier_warehouses table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_warehouses (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name                 VARCHAR(120) NOT NULL,   -- e.g. "Toronto DC"
  address              TEXT         NOT NULL,
  city                 VARCHAR(120),
  province             VARCHAR(120),
  postal_code          VARCHAR(20),
  country              VARCHAR(2)   NOT NULL DEFAULT 'CA',
  phone                VARCHAR(30),

  -- Regions this warehouse serves. Empty array = serves ALL regions
  -- (fallback for the default warehouse). Populated arrays let the
  -- (future) auto-router pick "closest warehouse that serves the
  -- merchant's province".
  serves_regions       TEXT[] NOT NULL DEFAULT '{}',

  -- Exactly ONE default per supplier (see partial unique index below).
  is_default           BOOLEAN NOT NULL DEFAULT false,
  is_active            BOOLEAN NOT NULL DEFAULT true,

  notes                TEXT,       -- freeform (opening hours, PO note, etc.)
  sort_order           INTEGER NOT NULL DEFAULT 0,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT supplier_warehouses_name_unique
    UNIQUE (supplier_tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_supplier_warehouses_tenant
  ON supplier_warehouses(supplier_tenant_id, is_active);

-- At most ONE default warehouse per supplier at any time. Partial unique
-- index — nothing prevents zero-default (early state, before a supplier
-- promotes one).
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_warehouses_one_default
  ON supplier_warehouses(supplier_tenant_id)
  WHERE is_default = true;

-- ---------------------------------------------------------------------------
-- 2. purchase_orders.warehouse_id
-- ---------------------------------------------------------------------------

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS warehouse_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchase_orders_warehouse_id_fkey'
  ) THEN
    ALTER TABLE purchase_orders
      ADD CONSTRAINT purchase_orders_warehouse_id_fkey
      FOREIGN KEY (warehouse_id) REFERENCES supplier_warehouses(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_po_warehouse
  ON purchase_orders(warehouse_id)
  WHERE warehouse_id IS NOT NULL;

COMMIT;
