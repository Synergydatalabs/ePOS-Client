-- =============================================================================
-- Phase F #6k (2026-08-28) — CC emails on supplier invoices.
--
-- Suppliers frequently want to notify accounting, procurement, and the
-- direct buyer on the same invoice. Adds a text array column so multiple
-- CC recipients can be stored without a separate table (they're always
-- looked up together with the invoice, no need for a join).
--
-- Idempotent — safe to re-run.
-- =============================================================================

ALTER TABLE supplier_invoices
  ADD COLUMN IF NOT EXISTS customer_cc_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN supplier_invoices.customer_cc_emails
  IS 'Additional email addresses CC''d on the invoice notification email (Phase F #6k).';
