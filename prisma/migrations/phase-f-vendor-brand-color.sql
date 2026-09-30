-- =============================================================================
-- Phase F #6s (2026-08-29) — vendor brand color for per-vendor theme swap.
--
-- Adds one column: vendor_brand_color. When set, the pay page uses it as
-- the primary color for hero + actions + accents when the invoice's product
-- has a vendor attached. Enables the UI expert's handoff design to render
-- for MegoPay invoices (electric blue) while Synergy services keep hub teal.
--
-- Hero darkening is derived at render time so we only store one color —
-- future vendors just pick their primary hex, no palette-building needed.
-- =============================================================================

BEGIN;

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS vendor_brand_color VARCHAR(7) NULL;

COMMENT ON COLUMN supplier_products.vendor_brand_color
  IS 'Vendor brand primary color (hex like #006AFF). When set + a vendor is attached, the pay page uses this as the theme instead of the supplier tenant''s color. Enables per-vendor pay-page themes on a reseller marketplace.';

-- Backfill: MegoPay = Electric Blue per the UI expert handoff brand guide.
UPDATE supplier_products
SET vendor_brand_color = '#006AFF'
WHERE supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND name = 'MegoPay Payment Gateway';

SELECT name, vendor_name, vendor_brand_color
FROM supplier_products
WHERE supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND name = 'MegoPay Payment Gateway';

COMMIT;
