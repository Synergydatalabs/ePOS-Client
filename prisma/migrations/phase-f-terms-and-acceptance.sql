-- =============================================================================
-- Phase F #3 (2026-08-27) — Supplier T&C versioning + acceptance capture.
--
-- Two new tables:
--   supplier_terms_versions      one row per T&C revision the supplier
--                                publishes; effective_to = NULL means it's
--                                the currently-active version
--   supplier_terms_acceptances   one row per pay-time acceptance, snapshotted
--                                (body + hash + IP + UA + geo + typed name +
--                                timestamp) for legal / chargeback defense
--
-- Safe to re-run: uses CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Zero downtime: only creates new tables, no touching of existing ones.
-- Existing invoices continue to work unchanged — they just won't have any
-- acceptance rows attached (legacy pre-Phase-3 behaviour).
--
-- To apply on EC2 (PowerShell):
--     psql "$env:DATABASE_URL" -f phase-f-terms-and-acceptance.sql
--
-- After applying: `npx prisma generate` in tap-app.
-- =============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- supplier_terms_versions
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_terms_versions (
  id                          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id          uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  version                     varchar(40)  NOT NULL,
  body_markdown               text         NOT NULL,

  effective_from              timestamptz  NOT NULL DEFAULT NOW(),
  -- NULL = active. Set to NOW() when a newer version is published.
  effective_to                timestamptz,

  created_by_membership_id    uuid,
  created_at                  timestamptz  NOT NULL DEFAULT NOW(),

  CONSTRAINT supplier_terms_versions_number_unique
    UNIQUE (supplier_tenant_id, version)
);

CREATE INDEX IF NOT EXISTS idx_supplier_terms_versions_active
  ON supplier_terms_versions (supplier_tenant_id, effective_to);


-- ------------------------------------------------------------------------------
-- supplier_terms_acceptances
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_terms_acceptances (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id    uuid         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  terms_version_id      uuid         NOT NULL REFERENCES supplier_terms_versions(id) ON DELETE RESTRICT,
  invoice_id            uuid         REFERENCES supplier_invoices(id) ON DELETE SET NULL,

  -- Who accepted
  accepted_name         varchar(255) NOT NULL,
  accepted_email        varchar(255) NOT NULL,

  -- Immutable snapshot of what they accepted
  terms_body_markdown   text         NOT NULL,
  terms_version         varchar(40)  NOT NULL,
  terms_hash            varchar(64)  NOT NULL,

  -- Context for legal defense
  ip_address            varchar(64),
  user_agent            text,
  geo_country           varchar(2),
  geo_region            varchar(100),
  geo_city              varchar(100),

  -- Deferred: S3 URL of a generated PDF proof
  proof_pdf_url         varchar(1000),

  accepted_at           timestamptz  NOT NULL DEFAULT NOW(),
  created_at            timestamptz  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_terms_acceptances_supplier_accepted_at
  ON supplier_terms_acceptances (supplier_tenant_id, accepted_at DESC);

CREATE INDEX IF NOT EXISTS idx_supplier_terms_acceptances_invoice
  ON supplier_terms_acceptances (invoice_id);

CREATE INDEX IF NOT EXISTS idx_supplier_terms_acceptances_email
  ON supplier_terms_acceptances (accepted_email);

CREATE INDEX IF NOT EXISTS idx_supplier_terms_acceptances_version
  ON supplier_terms_acceptances (terms_version_id);

-- The updated_at trigger function was created by phase-f-supplier-invoices.sql
-- (kept idempotent there); versions have no updated_at column (they're
-- append-only via effective_to), acceptances have no updated_at (immutable
-- proof records), so no triggers needed.

COMMIT;

-- Verify:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN ('supplier_terms_versions', 'supplier_terms_acceptances');
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
-- WHERE table_name = 'supplier_terms_acceptances' ORDER BY ordinal_position;
