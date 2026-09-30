-- ROLLBACK for 2026-08-02_billing_contact_email.sql.
--
-- Design changed: billing contact address is now derived at render time
-- from the current hostname (see src/lib/partner-billing.ts) rather
-- than being a per-tenant DB field. If you already applied the original
-- migration, run this to drop the now-unused column. If you never
-- applied it, ignore this file — nothing to do.

ALTER TABLE tenant_settings
  DROP COLUMN IF EXISTS billing_contact_email;
