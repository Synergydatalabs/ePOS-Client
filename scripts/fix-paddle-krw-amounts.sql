-- =============================================================================
-- fix-paddle-krw-amounts.sql
--
-- 2026-10-11: Paddle webhook was storing `amountPaidCents` as Paddle's raw
-- minor-unit total. For KRW/JPY/VND (zero-decimal currencies) Paddle's
-- "minor unit" == major unit (e.g. ₩8,000 → 8000), so our stored value
-- was ×100 too small vs. our internal "always cents" convention.
--
-- Fix: multiply amountPaidCents by 100 for Paddle-paid zero-decimal
-- invoices where the value is suspiciously small (looks un-×100'd).
--
-- Safety: only touches rows where paidMethod starts with 'paddle_' AND
-- currency is zero-decimal AND amountPaidCents is less than totalCents
-- (strong indicator it was the raw Paddle value, not the ×100 one). Rows
-- that already match totalCents are left alone — never multiplies twice.
--
-- Run first with the SELECT to preview, then run the UPDATE.
-- =============================================================================

-- Preview: see what will be touched
SELECT
  "id",
  "invoiceNumber",
  "currency",
  "paidMethod",
  "totalCents"       AS "total_cents_now",
  "amountPaidCents"  AS "paid_cents_now",
  "amountPaidCents" * 100 AS "paid_cents_after_fix"
FROM "supplier_invoices"
WHERE "paymentStatus" = 'PAID'
  AND "paidMethod" LIKE 'paddle_%'
  AND UPPER("currency") IN ('JPY','KRW','VND','CLP','ISK','UGX','RWF','XOF','XAF','PYG','DJF','GNF','KMF','MGA','BIF','XPF')
  AND "amountPaidCents" > 0
  AND "amountPaidCents" < "totalCents"   -- un-×100'd value is strictly smaller
ORDER BY "paidAt" DESC;

-- Apply the fix (commented out — uncomment to run)
-- UPDATE "supplier_invoices"
-- SET "amountPaidCents" = "amountPaidCents" * 100
-- WHERE "paymentStatus" = 'PAID'
--   AND "paidMethod" LIKE 'paddle_%'
--   AND UPPER("currency") IN ('JPY','KRW','VND','CLP','ISK','UGX','RWF','XOF','XAF','PYG','DJF','GNF','KMF','MGA','BIF','XPF')
--   AND "amountPaidCents" > 0
--   AND "amountPaidCents" < "totalCents";
