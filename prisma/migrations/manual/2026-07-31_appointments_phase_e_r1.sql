-- ============================================================================
-- Appointments Phase E — Round 1 foundation
-- Date: 2026-07-31
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. staff_schedules      — per-technician per-day-of-week working hours
--   2. staff_time_off       — full-day off ranges (holidays, sick days)
--
-- BUSINESS HOURS ARE NOT ADDED HERE — the existing Location.operatingHours
-- JSON column (used by reservation availability engine) is the single
-- source of truth for "when is this location open". Salon appointments
-- and restaurant reservations both read from it — one source, one editor
-- on Settings.
--
-- Day-of-week convention: 0 = Sunday, 6 = Saturday (matches JS Date.getDay()).
-- Both timestamp columns nullable → "closed that day".
--
-- Product.prepTimeMinutes is reused as service duration for salon
-- appointments (already in schema, no new column). Multi-service
-- bookings sum the durations at slot-selection time.
--
-- Idempotent — all CREATEs guarded.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. staff_schedules — per-technician working hours by day of week
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff_schedules (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id  UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  day_of_week    INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time     VARCHAR(5),
  end_time       VARCHAR(5),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_schedules_membership_day_unique UNIQUE (membership_id, day_of_week),
  CONSTRAINT staff_schedules_pair CHECK (
    (start_time IS NULL AND end_time IS NULL) OR
    (start_time IS NOT NULL AND end_time IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_staff_schedules_membership
  ON staff_schedules(membership_id);

-- ---------------------------------------------------------------------------
-- 2. staff_time_off — vacation / sick day ranges
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS staff_time_off (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id  UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  -- Inclusive on both ends. Single-day off = start_date == end_date.
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  reason         VARCHAR(255),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_time_off_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_staff_time_off_membership
  ON staff_time_off(membership_id, start_date, end_date);

COMMIT;
