-- =============================================================================
-- Phase F #6n (2026-08-28) — publish Synergy's professional services on the
-- marketplace.
--
-- Synergy's 10 catalog rows were saved as product_type='PHYSICAL' + is_public=false
-- (the default for a fresh supplier). They're actually services (website dev,
-- SEO, email marketing, etc.), so we bump their type to SERVICE and flip
-- them public so they appear in the /marketplace grid.
--
-- Paired with a filter-widening change in
-- src/app/api/marketplace/software/route.ts so SERVICE-type products show
-- alongside SOFTWARE ones.
-- =============================================================================

UPDATE supplier_products
SET
  product_type = 'SERVICE',
  is_public    = true
WHERE supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND product_type = 'PHYSICAL';

-- Sanity check — should return 10 rows all SERVICE + public + active.
SELECT id, name, product_type, is_public, is_active,
       (wholesale_price_cents / 100.0) AS price_cad
FROM supplier_products
WHERE supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
ORDER BY sort_order, name;
