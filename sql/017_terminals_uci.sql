-- ============================================================
-- UCI (Unified Cloud Integrations) support on terminals table
-- ============================================================
-- Adds columns for Global Payments' UCI cloud-relayed terminals
-- (Processing TID / Lane, environment, provider type, etc.)
-- Also relaxes the NOT NULL on ip_address since UCI terminals
-- don't need to be network-reachable from our server.
-- ============================================================

-- 1. Provider type (UPA = legacy TCP, UCI = Global Payments cloud)
ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'UCI';

-- 2. UCI-specific fields
ALTER TABLE terminals
  ADD COLUMN IF NOT EXISTS uci_lane VARCHAR(50),              -- Processing TID, e.g. OREUGO01
  ADD COLUMN IF NOT EXISTS uci_merchant_id VARCHAR(50),       -- Location ID from GP
  ADD COLUMN IF NOT EXISTS uci_environment VARCHAR(10) DEFAULT 'CERT'; -- CERT or PROD

-- 3. Make ip_address nullable (UCI doesn't need it)
ALTER TABLE terminals
  ALTER COLUMN ip_address DROP NOT NULL;

-- 4. Index for fast terminal lookup by Lane (used on webhook receive)
CREATE INDEX IF NOT EXISTS idx_terminals_uci_lane
  ON terminals(uci_lane)
  WHERE uci_lane IS NOT NULL;

-- 5. Drop old unique constraint (locationId + ipAddress + port) because
-- UCI terminals can share NULL ip_address within a location
ALTER TABLE terminals
  DROP CONSTRAINT IF EXISTS terminals_location_id_ip_address_port_key;

-- Replace with a UCI-aware unique: Lane must be unique per location
CREATE UNIQUE INDEX IF NOT EXISTS idx_terminals_location_lane_unique
  ON terminals(location_id, uci_lane)
  WHERE uci_lane IS NOT NULL;

-- For legacy UPA terminals, keep the old IP+port uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_terminals_location_ip_port_unique
  ON terminals(location_id, ip_address, port)
  WHERE ip_address IS NOT NULL;

-- ============================================================
-- Bills table — tracks every bill we push to a UCI terminal
-- One bill = one push to Global Payments for a specific order
-- Lifecycle: SENT -> DELIVERED -> PAID | CANCELLED | FAILED | EXPIRED
-- ============================================================
CREATE TABLE IF NOT EXISTS uci_bills (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  terminal_id       UUID NOT NULL REFERENCES terminals(id) ON DELETE RESTRICT,
  order_id          UUID REFERENCES orders(id) ON DELETE SET NULL,
  payment_id        UUID REFERENCES payments(id) ON DELETE SET NULL,

  -- Global Payments identifiers
  gp_bill_id        VARCHAR(100),                       -- ID GP assigns to the bill
  gp_transaction_id VARCHAR(100),                       -- GP transaction ID after payment

  -- Request snapshot
  amount            INT NOT NULL,                       -- cents
  tip_amount        INT DEFAULT 0,
  currency          VARCHAR(3) DEFAULT 'CAD',
  line_items        JSONB,                              -- what we sent
  request_payload   JSONB,                              -- full body sent to GP
  response_payload  JSONB,                              -- full response received

  -- Status tracking
  status            VARCHAR(20) NOT NULL DEFAULT 'SENT',  -- SENT, DELIVERED, PAID, CANCELLED, FAILED, EXPIRED
  status_reason     TEXT,
  auth_code         VARCHAR(30),
  card_last4        VARCHAR(4),
  card_brand        VARCHAR(20),
  entry_mode        VARCHAR(20),

  -- Audit
  created_by_id     UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at      TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_uci_bills_tenant     ON uci_bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_uci_bills_terminal   ON uci_bills(terminal_id);
CREATE INDEX IF NOT EXISTS idx_uci_bills_order      ON uci_bills(order_id);
CREATE INDEX IF NOT EXISTS idx_uci_bills_gp_bill_id ON uci_bills(gp_bill_id);
CREATE INDEX IF NOT EXISTS idx_uci_bills_status     ON uci_bills(status);
