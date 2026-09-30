-- =============================================================================
-- Phase F #6h (2026-08-28) — Fix Synergy Data Labs brand + contact.
--
-- The seed set brandPrimaryColor and contactEmail to placeholder values that
-- rendered the pay page in a purple/indigo tone with the wrong support
-- address. This script bumps them to hub teal and info@synergydatalabs.com.
--
-- Idempotent: only touches the synergy-data-labs tenant, always sets to the
-- canonical values.
-- =============================================================================

-- Update the brand colors + name + logo in TenantSettings
UPDATE tenant_settings
SET
  brand_primary_color = '#0F766E',   -- hub teal (Tailwind teal-700)
  brand_accent_color  = '#14B8A6',   -- hub teal-500 for lighter tints
  brand_background_color = '#FFFFFF',
  brand_name = 'Synergy Data Labs',
  -- Phase F #6i (2026-08-28): use the existing sdl.png asset in
  -- tap-app/public/images/logo/ as the supplier's brand logo. Shown in
  -- the pay page header. Relative path so it resolves against whichever
  -- host serves the page (hub.synergydatalabs.com in prod).
  brand_logo_url = '/images/logo/sdl.png'
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs');

-- Update the contact email on the SupplierProfile
UPDATE supplier_profiles
SET
  contact_email = 'info@synergydatalabs.com',
  display_name  = COALESCE(NULLIF(display_name, ''), 'Synergy Data Labs')
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs');

-- Sanity: show what we changed
SELECT
  t.slug,
  t.name,
  ts.brand_primary_color,
  ts.brand_accent_color,
  ts.brand_name,
  sp.contact_email,
  sp.display_name
FROM tenants t
LEFT JOIN tenant_settings ts   ON ts.tenant_id = t.id
LEFT JOIN supplier_profiles sp ON sp.tenant_id = t.id
WHERE t.slug = 'synergy-data-labs';
