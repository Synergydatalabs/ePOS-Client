-- Phase I #13 (2026-09-23): payment-method surcharge on supplier invoices.
--
-- Adds a two-column surcharge slot so the pay page can apply a
-- +2% UPI convenience fee (or any other method-specific fee) on the fly.
-- The /api/pay/invoice/[id]/stripe/adjust-surcharge endpoint updates
-- both the invoice total AND the Stripe PaymentIntent amount together
-- so what Stripe captures matches the reconciled invoice total.
--
-- Safe to re-run — IF NOT EXISTS on every column.

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS surcharge_cents INTEGER NOT NULL DEFAULT 0;

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS surcharge_label VARCHAR(80);

-- Sanity: surcharge should never be negative.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'supplier_invoices_surcharge_cents_nonneg'
  ) THEN
    ALTER TABLE supplier_invoices
      ADD CONSTRAINT supplier_invoices_surcharge_cents_nonneg
      CHECK (surcharge_cents >= 0);
  END IF;
END$$;
