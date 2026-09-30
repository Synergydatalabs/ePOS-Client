-- Phase I #15 (2026-09-26): per-tenant iframe embed toggle.
--
-- When false, /pay/embed/[invoiceId] returns 403 for this tenant's
-- invoices. Used for clients who should only send customers to our
-- hosted /l/[slug] payment link page instead of embedding our
-- checkout in their own site.

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS iframe_enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- Turn iframe off for the JokerPink Games tenant.
-- Payment link page /l/[slug] remains fully functional; only the
-- iframe embed at /pay/embed/[id] is blocked.
UPDATE tenant_settings
SET iframe_enabled = FALSE
WHERE tenant_id = (SELECT id FROM tenants WHERE slug = 'joker');
