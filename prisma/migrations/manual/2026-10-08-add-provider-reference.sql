-- 2026-10-08: Capture acquirer-side payment references (UPI RRN + VPA)
-- on every successful payment, so clients + compliance teams can reconcile
-- our invoices against bank / NPCI / processor statements.
--
-- Nullable + no backfill — existing paid invoices stay as-is; new payments
-- fill the columns via the Stripe webhook handler
-- (src/app/api/webhooks/payment/stripe/supplier-invoice/route.ts).
--
-- Run against the Aurora supplier_invoices table on prod. Safe to re-run:
-- IF NOT EXISTS guards every clause.

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS provider_reference VARCHAR(100),
  ADD COLUMN IF NOT EXISTS payer_vpa          VARCHAR(120);

-- Index for compliance / reconciliation lookups by UPI RRN. Nullable column
-- so the index is sparse and small until payments actually populate it.
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_provider_reference
  ON supplier_invoices (provider_reference)
  WHERE provider_reference IS NOT NULL;

COMMENT ON COLUMN supplier_invoices.provider_reference IS
  'Acquirer-side transaction reference (e.g. UPI RRN from NPCI, pulled from '
  'Stripe charges.data[0].payment_method_details.upi.reference). Null for '
  'methods that do not yield one (most card charges).';

COMMENT ON COLUMN supplier_invoices.payer_vpa IS
  'Buyer VPA for UPI payments, e.g. 9876543210@okaxis. Captured from Stripe '
  'for reconciliation + fraud review. Null for non-UPI methods.';
