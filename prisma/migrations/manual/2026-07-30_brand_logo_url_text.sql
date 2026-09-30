-- =====================================================================
-- Widen tenant_settings.brand_logo_url from VARCHAR(500) to TEXT
-- Date: 2026-07-30
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Reason: we switched logo uploads from S3-hosted URLs to inline
-- base64 data URLs (matching how Product.imageUrl already works). A
-- typical PNG logo base64-encodes to 50–500 KB of characters, which
-- doesn't fit in VARCHAR(500).
--
-- This ALTER is safe on data — any existing VARCHAR(500) values stay
-- intact; the column just accepts longer values going forward.
-- =====================================================================

BEGIN;

ALTER TABLE tenant_settings
  ALTER COLUMN brand_logo_url TYPE TEXT;

COMMIT;
