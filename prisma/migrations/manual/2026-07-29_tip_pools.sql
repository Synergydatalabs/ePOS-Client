-- =====================================================================
-- Tip Pools + Distribution
-- Date: 2026-07-29
-- Database: itap_pos_dev (Aurora Postgres, ca-central-1)
--
-- Purpose:
--   - Restaurants commonly pool tips from a shift and redistribute to
--     staff by hours, role, or evenly.
--   - A pool is created for a (location, period). Server auto-collects
--     Order.tipAmount for orders paid in the period + TimeClockEntry
--     hours for members clocked in during the period.
--   - Distribution shares are computed by the rule stored on the pool
--     (BY_HOURS / EVENLY / BY_ROLE). Admin can adjust before closing.
--
-- Flow: OPEN (draft) → DISTRIBUTED (shares computed, editable) → CLOSED (locked)
--
-- HOW TO APPLY:
--   1. psql to Aurora from EC2
--   2. \i this file
--   3. On EC2: pull schema.prisma, run `npx prisma generate`
-- =====================================================================

BEGIN;

CREATE TYPE "TipPoolStatus" AS ENUM ('OPEN', 'DISTRIBUTED', 'CLOSED');
CREATE TYPE "TipPoolRule" AS ENUM ('BY_HOURS', 'EVENLY', 'BY_ROLE');

CREATE TABLE tip_pools (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id   UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,

  status        "TipPoolStatus" NOT NULL DEFAULT 'OPEN',
  rule          "TipPoolRule"   NOT NULL DEFAULT 'BY_HOURS',

  -- Period the pool covers. Both required so we know what orders / shifts
  -- roll into it.
  period_start  TIMESTAMPTZ NOT NULL,
  period_end    TIMESTAMPTZ NOT NULL,

  -- Auto-collected on distribute; can be manually overridden before close
  tips_collected INTEGER NOT NULL DEFAULT 0 CHECK (tips_collected >= 0),

  -- Snapshot of the by-role weights that produced the shares (JSON so the
  -- rule can evolve without a schema change). Only populated when
  -- rule = 'BY_ROLE'. Example: {"POS_STAFF": 100, "KITCHEN_STAFF": 30}
  role_weights  JSONB,

  notes         TEXT,

  created_by_id UUID REFERENCES memberships(id) ON DELETE SET NULL,
  closed_by_id  UUID REFERENCES memberships(id) ON DELETE SET NULL,
  closed_at     TIMESTAMPTZ,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (period_end > period_start)
);

CREATE INDEX idx_tip_pools_tenant_period ON tip_pools (tenant_id, period_start DESC);
CREATE INDEX idx_tip_pools_location ON tip_pools (location_id, period_start DESC);
CREATE INDEX idx_tip_pools_status ON tip_pools (tenant_id, status);

CREATE TABLE tip_distributions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pool_id       UUID NOT NULL REFERENCES tip_pools(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,

  -- Contribution inputs — snapshotted at distribution time so recomputing
  -- the pool later doesn't drift shares even if TimeClockEntry gets edited.
  hours_worked  NUMERIC(6, 2) NOT NULL DEFAULT 0,
  role          VARCHAR(30) NOT NULL,
  weight        NUMERIC(6, 2) NOT NULL DEFAULT 0,

  share_amount  INTEGER NOT NULL CHECK (share_amount >= 0),

  notes         TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (pool_id, membership_id)
);

CREATE INDEX idx_tip_distributions_pool ON tip_distributions (pool_id);
CREATE INDEX idx_tip_distributions_member ON tip_distributions (membership_id, created_at DESC);

COMMIT;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS tip_distributions;
--   DROP TABLE IF EXISTS tip_pools;
--   DROP TYPE IF EXISTS "TipPoolRule";
--   DROP TYPE IF EXISTS "TipPoolStatus";
-- COMMIT;
