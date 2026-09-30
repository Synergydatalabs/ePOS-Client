-- =====================================================================
-- Cash Drawer Sessions
-- Date: 2026-07-29
-- Database: itap_pos_dev (Aurora Postgres, ca-central-1)
--
-- HOW TO APPLY:
--   1. psql to Aurora from EC2
--   2. \i this file
--   3. Verify: \dt cash_drawer_sessions, cash_movements
--   4. On EC2: pull schema.prisma changes, run `npx prisma generate`
--
-- ROLLBACK: see bottom of file.
-- =====================================================================

BEGIN;

-- ── Enums ────────────────────────────────────────────────────────────
CREATE TYPE "CashDrawerStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TYPE "CashMovementType" AS ENUM (
  'OPENING',   -- initial float when the drawer is opened
  'PAYMENT',   -- cash coming in from a sale (auto-logged)
  'REFUND',    -- cash going out for a refund (auto-logged, negative)
  'PAYOUT',    -- cash removed for a business expense / tips / etc.
  'PAYIN',     -- cash added mid-shift (e.g. change from bank)
  'DROP',      -- cash dropped to safe / deposit
  'CLOSING'    -- adjustment recorded at close to reconcile
);

-- ── Table: cash_drawer_sessions ──────────────────────────────────────
CREATE TABLE cash_drawer_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id       UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  terminal_id       UUID REFERENCES terminals(id) ON DELETE SET NULL,

  status            "CashDrawerStatus" NOT NULL DEFAULT 'OPEN',

  -- Opening state
  opening_float     INTEGER NOT NULL CHECK (opening_float >= 0),
  opening_note      TEXT,
  opened_by_id      UUID REFERENCES memberships(id) ON DELETE SET NULL,
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Closing state (nullable while OPEN)
  closing_count     INTEGER,           -- physical cash counted at close
  expected_cash     INTEGER,           -- opening_float + sum of movements
  variance          INTEGER,           -- closing_count - expected_cash (± cents)
  closing_note      TEXT,
  closed_by_id      UUID REFERENCES memberships(id) ON DELETE SET NULL,
  closed_at         TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one OPEN drawer per (location, terminal) at a time. NULL terminal
-- means "no specific register" — still only one OPEN at that location
-- because Postgres treats NULLs as distinct in unique constraints, so we
-- also add a partial index to catch the single-null case.
CREATE UNIQUE INDEX idx_cash_drawer_one_open_per_terminal
  ON cash_drawer_sessions (location_id, terminal_id)
  WHERE status = 'OPEN' AND terminal_id IS NOT NULL;

CREATE UNIQUE INDEX idx_cash_drawer_one_open_no_terminal
  ON cash_drawer_sessions (location_id)
  WHERE status = 'OPEN' AND terminal_id IS NULL;

CREATE INDEX idx_cash_drawer_tenant_status ON cash_drawer_sessions (tenant_id, status);
CREATE INDEX idx_cash_drawer_opened_at ON cash_drawer_sessions (opened_at DESC);

-- ── Table: cash_movements (append-only ledger per session) ───────────
CREATE TABLE cash_movements (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,

  type              "CashMovementType" NOT NULL,
  -- Signed cents: positive = cash INTO drawer, negative = cash OUT
  amount            INTEGER NOT NULL,

  -- Optional references — set for PAYMENT/REFUND rows so the audit trail
  -- can prove where the cash came from / went.
  order_id          UUID REFERENCES orders(id) ON DELETE SET NULL,
  payment_id        UUID REFERENCES payments(id) ON DELETE SET NULL,

  reason            TEXT,
  performed_by_id   UUID REFERENCES memberships(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cash_movements_session ON cash_movements (session_id, created_at);
CREATE INDEX idx_cash_movements_payment ON cash_movements (payment_id)
  WHERE payment_id IS NOT NULL;

COMMIT;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS cash_movements;
--   DROP TABLE IF EXISTS cash_drawer_sessions;
--   DROP TYPE IF EXISTS "CashMovementType";
--   DROP TYPE IF EXISTS "CashDrawerStatus";
-- COMMIT;
