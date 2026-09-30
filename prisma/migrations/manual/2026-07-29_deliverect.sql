-- =====================================================================
-- Deliverect Integration
-- Date: 2026-07-29
-- Database: itap_pos_dev (Aurora Postgres, ca-central-1)
--
-- Deliverect is a middleware that connects one POS integration to
-- DoorDash / Uber Eats / SkipTheDishes / etc. Each merchant has their
-- own Deliverect account (they pay Deliverect directly, ~$50–100/mo)
-- and provides us their API credentials + location ID.
--
-- This migration:
--   1. Adds DELIVERECT to the "IntegrationProvider" enum (from Task #44)
--   2. Adds per-integration extras columns on integration_connections
--      that aren't specific to QBO — external_location_id (Deliverect's
--      location id), webhook_secret_enc (for verifying inbound webhooks),
--      api_key_enc / api_secret_enc (Deliverect account credentials,
--      alternative to full OAuth for MVP)
--   3. Creates deliverect_order_log so we can trace which delivery
--      platform each Order came from
--
-- HOW TO APPLY:
--   1. psql to Aurora from EC2
--   2. \i this file
--   3. On EC2: pull schema.prisma changes, run `npx prisma generate`
-- =====================================================================

BEGIN;

-- Postgres blocks adding an enum value inside a tx if it's about to be
-- used in the same tx — but we're only altering the enum and adding
-- columns / tables that will use it, so this order is safe.
ALTER TYPE "IntegrationProvider" ADD VALUE 'DELIVERECT';

ALTER TABLE integration_connections
  ADD COLUMN external_location_id VARCHAR(64),
  ADD COLUMN webhook_secret_enc   TEXT,
  ADD COLUMN api_key_enc          TEXT,
  ADD COLUMN api_secret_enc       TEXT;

CREATE INDEX idx_integration_connections_external_loc
  ON integration_connections (external_location_id)
  WHERE external_location_id IS NOT NULL;

-- Per-order provenance: which delivery channel did this order arrive
-- from? Doubles as an idempotency guard (unique per external_order_id
-- from Deliverect so a retried webhook can't create a duplicate order).
CREATE TABLE deliverect_orders (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id         UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  order_id              UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,

  -- Deliverect assigns these
  external_order_id     VARCHAR(128) NOT NULL,
  channel               VARCHAR(50) NOT NULL,     -- 'doordash', 'uber_eats', 'skip', ...
  channel_order_number  VARCHAR(64),              -- Human-friendly # from the channel
  raw_payload           JSONB NOT NULL,           -- Full webhook body for audit / debug

  received_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (connection_id, external_order_id)
);

-- Unique index (not plain index) — every iTap Order maps to at most
-- one DeliverectOrder row. Matches the Prisma one-to-one back-relation.
CREATE UNIQUE INDEX idx_deliverect_orders_order ON deliverect_orders (order_id);
CREATE INDEX idx_deliverect_orders_channel ON deliverect_orders (channel, received_at DESC);

COMMIT;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- Note: Postgres can't drop an enum value in place. Rollback would
-- require rebuilding the enum + retyping the column. Full rollback:
-- BEGIN;
--   DROP TABLE IF EXISTS deliverect_orders;
--   ALTER TABLE integration_connections DROP COLUMN IF EXISTS api_secret_enc;
--   ALTER TABLE integration_connections DROP COLUMN IF EXISTS api_key_enc;
--   ALTER TABLE integration_connections DROP COLUMN IF EXISTS webhook_secret_enc;
--   ALTER TABLE integration_connections DROP COLUMN IF EXISTS external_location_id;
--   -- Enum value cleanup requires:
--   -- CREATE TYPE "IntegrationProvider"_new AS ENUM ('QUICKBOOKS_US','QUICKBOOKS_CA');
--   -- ALTER TABLE integration_connections ALTER COLUMN provider TYPE "IntegrationProvider"_new USING provider::text::"IntegrationProvider"_new;
--   -- DROP TYPE "IntegrationProvider";
--   -- ALTER TYPE "IntegrationProvider"_new RENAME TO "IntegrationProvider";
-- COMMIT;
