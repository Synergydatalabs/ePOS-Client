-- =============================================================================
-- Phase F #1 (2026-08-27) — Software product fields on supplier_products.
--
-- Extends SupplierProduct to distinguish physical goods from software listings
-- and store software-specific metadata (download URL, license model, pricing
-- model, trial period, system requirements, version, docs).
--
-- Safe to re-run: every ADD COLUMN uses IF NOT EXISTS.
-- Zero downtime: all new columns are nullable or defaulted, so existing rows
-- keep working unchanged (product_type defaults to 'PHYSICAL' for every legacy
-- row, which preserves current supplier-catalog behaviour).
--
-- To apply on EC2:
--     psql "$env:DATABASE_URL" -f phase-f-software-fields.sql
--
-- After applying: update BOTH schema.prisma files (admin-app + tap-app) if
-- admin-app also references SupplierProduct, then `npx prisma generate` in
-- tap-app (per project convention — no db push / no db pull).
-- =============================================================================

BEGIN;

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS product_type             varchar(20)  NOT NULL DEFAULT 'PHYSICAL',
  ADD COLUMN IF NOT EXISTS software_download_url    varchar(1000),
  ADD COLUMN IF NOT EXISTS software_docs_url        varchar(1000),
  ADD COLUMN IF NOT EXISTS software_version         varchar(40),
  ADD COLUMN IF NOT EXISTS software_requirements    text,
  ADD COLUMN IF NOT EXISTS software_license_model   varchar(60),
  ADD COLUMN IF NOT EXISTS software_pricing_model   varchar(20)  DEFAULT 'ONE_TIME',
  ADD COLUMN IF NOT EXISTS software_trial_days      integer;

-- Marketplace browse queries will filter by product_type frequently
-- ("show me all SOFTWARE listings"). Partial index keeps it tight — only
-- indexes the software rows since PHYSICAL is the vast majority today.
CREATE INDEX IF NOT EXISTS idx_supplier_products_software_active
  ON supplier_products (supplier_tenant_id, is_public, is_active)
  WHERE product_type = 'SOFTWARE';

COMMIT;

-- Verify:
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_name = 'supplier_products'
--   AND column_name LIKE 'software_%' OR column_name = 'product_type'
-- ORDER BY ordinal_position;
