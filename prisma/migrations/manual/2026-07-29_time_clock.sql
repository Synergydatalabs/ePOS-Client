-- =====================================================================
-- Employee Time Clock
-- Date: 2026-07-29
-- Database: itap_pos_dev (Aurora Postgres, ca-central-1)
--
-- HOW TO APPLY:
--   1. psql to Aurora from EC2
--   2. \i this file
--   3. Verify: \dt time_clock_entries, time_clock_breaks
--   4. On EC2: pull schema.prisma changes, run `npx prisma generate`
--
-- ROLLBACK: see bottom of file.
-- =====================================================================

BEGIN;

CREATE TYPE "TimeClockStatus" AS ENUM ('ACTIVE', 'ON_BREAK', 'CLOSED');
CREATE TYPE "TimeClockBreakType" AS ENUM ('MEAL', 'REST');

CREATE TABLE time_clock_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  membership_id     UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  location_id       UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,

  status            "TimeClockStatus" NOT NULL DEFAULT 'ACTIVE',

  clocked_in_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  clocked_out_at    TIMESTAMPTZ,

  -- Computed at close so reports don't have to re-derive on every read.
  total_minutes     INTEGER,      -- worked minutes = out - in - breaks
  break_minutes     INTEGER,      -- sum of all break durations

  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one open entry per staff member — the app UI enforces this too,
-- but the DB is the source of truth in case of a race.
CREATE UNIQUE INDEX idx_time_clock_one_open_per_member
  ON time_clock_entries (membership_id)
  WHERE status <> 'CLOSED';

CREATE INDEX idx_time_clock_tenant_date ON time_clock_entries (tenant_id, clocked_in_at DESC);
CREATE INDEX idx_time_clock_member ON time_clock_entries (membership_id, clocked_in_at DESC);

CREATE TABLE time_clock_breaks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id          UUID NOT NULL REFERENCES time_clock_entries(id) ON DELETE CASCADE,

  type              "TimeClockBreakType" NOT NULL DEFAULT 'REST',

  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at          TIMESTAMPTZ,
  minutes           INTEGER,      -- stamped at close

  notes             TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one break per entry may be active at a time
CREATE UNIQUE INDEX idx_time_clock_one_active_break
  ON time_clock_breaks (entry_id)
  WHERE ended_at IS NULL;

CREATE INDEX idx_time_clock_breaks_entry ON time_clock_breaks (entry_id, started_at);

COMMIT;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS time_clock_breaks;
--   DROP TABLE IF EXISTS time_clock_entries;
--   DROP TYPE IF EXISTS "TimeClockBreakType";
--   DROP TYPE IF EXISTS "TimeClockStatus";
-- COMMIT;
