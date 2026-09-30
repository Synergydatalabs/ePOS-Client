-- =============================================================================
-- Phase H #1 (2026-09-02): per-product currency
--
-- Previously every SupplierProduct's price was implicitly in the supplier
-- tenant's default currency. Vendors that price globally (a Mego licence
-- always quoted in USD, an AI model in EUR) had to store the price
-- pre-converted to CAD, which broke every invoice.
--
-- Adds a `price_currency` column to supplier_products, defaulting to 'CAD'
-- for backwards compatibility with existing rows. The ProductModal + API +
-- InvoiceModal read this and use it as the per-line invoice currency.
-- =============================================================================

-- Fresh column with a safe default. Existing rows implicitly become CAD.
ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS price_currency VARCHAR(3) NOT NULL DEFAULT 'CAD';

-- Sanity: every existing row now has a currency (defaults are applied on
-- ADD COLUMN NOT NULL DEFAULT — this UPDATE is redundant but explicit).
UPDATE supplier_products
   SET price_currency = 'CAD'
 WHERE price_currency IS NULL;

-- Verify shape.
--   SELECT id, name, wholesale_price_cents, price_currency
--     FROM supplier_products LIMIT 5;
