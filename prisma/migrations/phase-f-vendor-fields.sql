-- =============================================================================
-- Phase F #6r (2026-08-29) — vendor identity fields on supplier_products.
--
-- On a reseller marketplace, the customer needs to see WHO MADE the software
-- (the vendor), even though hub is who's selling and being paid. Adds four
-- optional fields per product: vendor name, logo URL, website URL, support
-- email. Populated per-product by the supplier.
--
-- Pay page uses these to render a "Sold by hub — MegoPay by RBP FINIVIS" strip
-- with the vendor's own logo, so a customer buying MegoPay sees MegoPay's
-- brand prominently on the pay page while Synergy stays as merchant of record.
--
-- Also backfills the existing MegoPay Payment Gateway product row with its
-- real vendor info from the handoff. All other products stay null (they're
-- Synergy's own services — no third-party vendor).
-- =============================================================================

BEGIN;

-- 1. Schema
ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS vendor_name          VARCHAR(255)  NULL,
  ADD COLUMN IF NOT EXISTS vendor_logo_url      VARCHAR(1000) NULL,
  ADD COLUMN IF NOT EXISTS vendor_website_url   VARCHAR(1000) NULL,
  ADD COLUMN IF NOT EXISTS vendor_support_email VARCHAR(255)  NULL;

COMMENT ON COLUMN supplier_products.vendor_name
  IS 'Software creator / third-party vendor name. Shown on pay page as "Sold by hub — {Vendor}". Null = no separate vendor (supplier''s own product).';
COMMENT ON COLUMN supplier_products.vendor_logo_url
  IS 'Vendor logo — displayed prominently in the pay page hero when set. Recommended: square 512x512.';
COMMENT ON COLUMN supplier_products.vendor_website_url
  IS 'Vendor''s own website (e.g. rbpfinivis.com). Linked from the pay page vendor strip.';
COMMENT ON COLUMN supplier_products.vendor_support_email
  IS 'Where product-support requests are directed. Kept separate from hub''s billing support.';

-- 2. Backfill the MegoPay Payment Gateway product with its vendor info.
UPDATE supplier_products
SET
  vendor_name          = 'MegoPay',
  vendor_logo_url      = '/images/logo/mego-pay-logo.png',
  vendor_website_url   = 'https://rbpfinivis.com',
  vendor_support_email = 'support@rbpfinivis.com'
WHERE supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND name = 'MegoPay Payment Gateway';

-- 3. Verify
SELECT
  name,
  vendor_name,
  vendor_logo_url,
  vendor_website_url,
  vendor_support_email,
  terms_version_id IS NOT NULL AS has_terms
FROM supplier_products
WHERE supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND name = 'MegoPay Payment Gateway';

COMMIT;
