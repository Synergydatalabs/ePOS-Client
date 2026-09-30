-- ============================================================================
-- Purchase Order payment link fields — Phase C #67
-- Date: 2026-07-30
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. Enum: POPaymentStatus  (renamed from PaymentStatus to avoid a
--      collision with the existing merchant-side PaymentStatus enum)
--   2. Payment fields on purchase_orders (link URL, reference, status,
--      captured amount / method / timestamp)
--   3. Index on payment_link_reference for the webhook path (#68 uses this
--      to find a PO from a processor's transaction id)
--
-- Idempotent — every ADD COLUMN uses IF NOT EXISTS, enum guarded by DO
-- block.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enum
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'POPaymentStatus') THEN
    CREATE TYPE "POPaymentStatus" AS ENUM (
      'UNPAID',
      'PENDING',
      'PAID',
      'FAILED',
      'REFUNDED'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Payment fields on purchase_orders
-- ---------------------------------------------------------------------------

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS payment_status "POPaymentStatus" NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS payment_link_url          TEXT,
  ADD COLUMN IF NOT EXISTS payment_link_reference    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS payment_link_expires_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_link_failure_note TEXT,
  ADD COLUMN IF NOT EXISTS paid_at                   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_amount_cents         INT,
  ADD COLUMN IF NOT EXISTS paid_method               VARCHAR(50);

-- Sanity: paid amount can't be negative
ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS po_paid_amount_nonneg;
ALTER TABLE purchase_orders
  ADD CONSTRAINT po_paid_amount_nonneg
    CHECK (paid_amount_cents IS NULL OR paid_amount_cents >= 0);

-- ---------------------------------------------------------------------------
-- 3. Index for the webhook lookup path
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_purchase_orders_payment_link_reference
  ON purchase_orders(payment_link_reference)
  WHERE payment_link_reference IS NOT NULL;

COMMIT;
