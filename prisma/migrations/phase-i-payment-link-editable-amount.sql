-- ============================================================================
-- Phase I #12 (2026-09-22) — Editable amount on payment links
--
-- Lets the supplier flip a "customer can edit amount" toggle on a payment
-- link. Optional min/max bounds constrain what a customer can pay. Default
-- for existing links is locked (amount_locked = true) so nothing changes
-- for links already in the wild.
-- ============================================================================

BEGIN;

ALTER TABLE supplier_payment_links
  ADD COLUMN IF NOT EXISTS amount_locked    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS amount_min_cents INTEGER,
  ADD COLUMN IF NOT EXISTS amount_max_cents INTEGER;

-- Sanity: min <= max when both set (checked at app layer too).
ALTER TABLE supplier_payment_links
  DROP CONSTRAINT IF EXISTS supplier_payment_links_amount_bounds_check;
ALTER TABLE supplier_payment_links
  ADD CONSTRAINT supplier_payment_links_amount_bounds_check
  CHECK (
    amount_min_cents IS NULL
    OR amount_max_cents IS NULL
    OR amount_min_cents <= amount_max_cents
  );

COMMIT;
