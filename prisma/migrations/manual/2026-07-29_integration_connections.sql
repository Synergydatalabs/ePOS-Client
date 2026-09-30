-- =====================================================================
-- Integration Connections + QBO Sync Log
-- Date: 2026-07-29
-- Database: itap_pos_dev (Aurora Postgres, ca-central-1)
--
-- Generic OAuth-token storage table so we can plug additional providers
-- (Xero, FreshBooks, Sage) onto the same shape later. QBO US and QBO CA
-- are separate Intuit apps with different API base URLs, so they get
-- their own provider values.
--
-- Tokens are stored encrypted at the app layer (see lib/integration-crypto.ts)
-- so a DB dump alone doesn't leak credentials.
--
-- HOW TO APPLY:
--   1. psql to Aurora from EC2
--   2. \i this file
--   3. On EC2: pull schema.prisma, run `npx prisma generate`
-- =====================================================================

BEGIN;

CREATE TYPE "IntegrationProvider" AS ENUM (
  'QUICKBOOKS_US',
  'QUICKBOOKS_CA'
);

CREATE TYPE "IntegrationStatus" AS ENUM (
  'DISCONNECTED',
  'CONNECTED',
  'ERROR',
  'REVOKED'
);

CREATE TABLE integration_connections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider              "IntegrationProvider" NOT NULL,
  status                "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',

  -- OAuth tokens (encrypted). Ciphertext + iv concatenated as base64.
  access_token_enc      TEXT,
  refresh_token_enc     TEXT,
  access_token_expires  TIMESTAMPTZ,

  -- Provider-specific identifiers
  realm_id              VARCHAR(64),    -- QBO company id
  company_name          VARCHAR(255),

  -- Mapping fields — QBO account references for the daily journal
  -- entry. Nullable so merchants can partially configure and iterate.
  sales_account_ref     VARCHAR(64),
  tax_liability_ref     VARCHAR(64),
  tips_liability_ref    VARCHAR(64),
  discounts_account_ref VARCHAR(64),
  refunds_account_ref   VARCHAR(64),
  cash_account_ref      VARCHAR(64),
  card_account_ref      VARCHAR(64),

  -- Sync bookkeeping
  last_sync_at          TIMESTAMPTZ,
  last_error            TEXT,
  last_error_at         TIMESTAMPTZ,

  connected_by_id       UUID REFERENCES memberships(id) ON DELETE SET NULL,
  connected_at          TIMESTAMPTZ,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (tenant_id, provider)
);

CREATE INDEX idx_integration_connections_tenant ON integration_connections (tenant_id);
CREATE INDEX idx_integration_connections_status ON integration_connections (tenant_id, status);

-- Per-day sync log so admins can see what was pushed and when. Includes
-- the JE ref returned by QBO so the merchant can jump into QBO and pull
-- it up. Also captures dry-run pushes for audit.
CREATE TABLE integration_sync_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id     UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,

  -- Business date the entry covers (not created_at) — we key off this
  -- for "already pushed today" dedupe.
  business_date     DATE NOT NULL,
  dry_run           BOOLEAN NOT NULL DEFAULT FALSE,
  success           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Full payload we sent + response we got back, JSON for audit / debug
  payload           JSONB NOT NULL,
  response          JSONB,
  error             TEXT,

  -- QBO journal-entry Id (populated on success)
  external_ref      VARCHAR(64),

  performed_by_id   UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_integration_sync_log_conn_date
  ON integration_sync_log (connection_id, business_date DESC);
CREATE INDEX idx_integration_sync_log_success
  ON integration_sync_log (connection_id, success, business_date DESC);

COMMIT;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS integration_sync_log;
--   DROP TABLE IF EXISTS integration_connections;
--   DROP TYPE IF EXISTS "IntegrationStatus";
--   DROP TYPE IF EXISTS "IntegrationProvider";
-- COMMIT;
