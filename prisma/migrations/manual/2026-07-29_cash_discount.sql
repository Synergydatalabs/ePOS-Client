-- =====================================================================
-- Cash Discount / Dual Pricing
-- Date: 2026-07-29
-- Database: itap_pos_dev (Aurora Postgres, ca-central-1)
--
-- Two legally-common patterns in the US (and increasingly CA):
--   SURCHARGE mode  — displayed prices are the "cash" price. Card
--                     customers pay an X% surcharge added at checkout.
--   DISCOUNT mode   — displayed prices are the "card" price. Cash
--                     customers get an X% discount at checkout.
--
-- Both patterns need the same fields (percent + mode label). We store
-- the applied surcharge (positive cents, when relevant) on the order
-- so receipts and reports show it clearly. Cash discounts land in the
-- existing discount_amount field with a note.
--
-- HOW TO APPLY:
--   1. psql to Aurora from EC2
--   2. \i this file
--   3. On EC2: pull schema.prisma, run `npx prisma generate`
--
-- ROLLBACK: see bottom.
-- =====================================================================

BEGIN;

ALTER TABLE tenant_settings
  ADD COLUMN cash_discount_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN cash_discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0
    CHECK (cash_discount_percent >= 0 AND cash_discount_percent <= 15),
  ADD COLUMN cash_discount_mode    VARCHAR(20) NOT NULL DEFAULT 'SURCHARGE'
    CHECK (cash_discount_mode IN ('SURCHARGE', 'DISCOUNT')),
  ADD COLUMN cash_discount_label   VARCHAR(60);

ALTER TABLE orders
  ADD COLUMN surcharge_amount INTEGER NOT NULL DEFAULT 0
    CHECK (surcharge_amount >= 0);

COMMIT;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- BEGIN;
--   ALTER TABLE orders           DROP COLUMN IF EXISTS surcharge_amount;
--   ALTER TABLE tenant_settings  DROP COLUMN IF EXISTS cash_discount_label;
--   ALTER TABLE tenant_settings  DROP COLUMN IF EXISTS cash_discount_mode;
--   ALTER TABLE tenant_settings  DROP COLUMN IF EXISTS cash_discount_percent;
--   ALTER TABLE tenant_settings  DROP COLUMN IF EXISTS cash_discount_enabled;
-- COMMIT;
