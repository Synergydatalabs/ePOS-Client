-- ============================================================================
-- Phase I #6 (2026-09-18) — Payments API (public inbound endpoint)
--
-- What this ships:
--   1. `api_keys` — bearer keys tenants mint in the supplier portal; the
--      partner's server sends them as `Authorization: Bearer …` to
--      /api/public/v1/payments. Stored SHA-256 hashed (never plaintext).
--   2. Two nullable columns on `supplier_payment_links` so a link created
--      by the public API is (a) tagged and (b) traceable back to the key.
--      Existing portal-created links keep NULL in both — no behaviour
--      change for the current UI.
--
-- Design notes:
--   * key_hash is unique + b-tree indexed → constant-time lookup.
--   * key_last4 is shown in the UI ("oreugo_sk_live_...abcd") so the
--     supplier can identify a key without seeing the secret.
--   * No test/live distinction on the key itself — the underlying Stripe
--     mode is a property of the tenant's TenantPaymentProvider config.
--     A single key operates against whichever Stripe env the tenant has
--     wired at call time.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS api_keys (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                      VARCHAR(120) NOT NULL,
  key_hash                  VARCHAR(64) NOT NULL,   -- SHA-256 hex
  key_last4                 VARCHAR(8)  NOT NULL,
  key_prefix                VARCHAR(24) NOT NULL DEFAULT 'oreugo_sk',
  enabled                   BOOLEAN     NOT NULL DEFAULT TRUE,
  last_used_at              TIMESTAMPTZ,
  last_used_ip              VARCHAR(64),
  created_by_membership_id  UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at                TIMESTAMPTZ,
  CONSTRAINT api_keys_key_hash_unique UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys (tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_enabled   ON api_keys (enabled) WHERE enabled = TRUE;

-- ---------------------------------------------------------------------------
-- supplier_payment_links: tag API-created links + back-ref the key.
-- ---------------------------------------------------------------------------
ALTER TABLE supplier_payment_links
  ADD COLUMN IF NOT EXISTS api_generated   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS created_via_api_key_id UUID
    REFERENCES api_keys(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payment_links_api_generated
  ON supplier_payment_links (supplier_tenant_id, api_generated);

COMMIT;
