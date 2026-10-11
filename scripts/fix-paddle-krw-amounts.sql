-- =============================================================================
-- fix-paddle-krw-amounts.sql
--
-- 2026-10-11: Paddle webhook was storing amount_paid_cents as Paddle's raw
-- minor-unit total. For KRW/JPY/VND (zero-decimal currencies) Paddle's
-- "minor unit" == major unit (e.g. ₩8,000 → 8000), so our stored value
-- was ×100 too small vs. our internal "always cents" convention.
--
-- Fix: multiply amount_paid_cents by 100 for Paddle-paid zero-decimal
-- invoices where the value is suspiciously small (looks un-×100'd).
--
-- Safety: only touches rows where paid_method starts with 'paddle_' AND
-- currency is zero-decimal AND amount_paid_cents < total_cents (strong
-- indicator it was the raw Paddle value, not the ×100 one). Rows that
-- already match total_cents are left alone — never multiplies twice.
--
-- Column names: snake_case because the DB has them snake_case (Prisma
-- maps to camelCase in app code, but raw SQL uses the real names).
--
-- Run first with the SELECT to preview, then run the UPDATE.
-- =============================================================================

-- Preview: see what will be touched
SELECT
  id,
  invoice_number,
  currency,
  paid_method,
  total_cents        AS total_cents_now,
  amount_paid_cents  AS paid_cents_now,
  amount_paid_cents * 100 AS paid_cents_after_fix
FROM supplier_invoices
WHERE payment_status = 'PAID'
  AND paid_method LIKE 'paddle_%'
  AND UPPER(currency) IN ('JPY','KRW','VND','CLP','ISK','UGX','RWF','XOF','XAF','PYG','DJF','GNF','KMF','MGA','BIF','XPF')
  AND amount_paid_cents > 0
  AND amount_paid_cents < total_cents
ORDER BY paid_at DESC;

-- Apply the fix (commented out — uncomment to run)
-- UPDATE supplier_invoices
-- SET amount_paid_cents = amount_paid_cents * 100
-- WHERE payment_status = 'PAID'
--   AND paid_method LIKE 'paddle_%'
--   AND UPPER(currency) IN ('JPY','KRW','VND','CLP','ISK','UGX','RWF','XOF','XAF','PYG','DJF','GNF','KMF','MGA','BIF','XPF')
--   AND amount_paid_cents > 0
--   AND amount_paid_cents < total_cents;
