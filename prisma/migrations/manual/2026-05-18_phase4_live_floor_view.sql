-- =====================================================================
-- Phase 4 Migration: Live Floor View (server colors + table status timestamps)
-- Date: 2026-05-18
--
-- Adds:
--   - memberships.color (per-server hex color, for visual identification)
--   - tables.current_server_id (which server "owns" this table right now)
--   - tables.seated_at (when guests were seated — drives turn-time bar)
--   - tables.last_status_change_at (for stale-state detection)
--   - Index for active-table queries used by live floor view
--
-- Note: the `status` column on tables already exists from earlier phases
-- (AVAILABLE / OCCUPIED / RESERVED / CLEANING / BLOCKED). We're not adding
-- a new enum — just supporting fields.
-- =====================================================================

BEGIN;

-- Per-server color for visual identification on floor view
-- (Toast pattern — each server has a color, their tables fill with it)
ALTER TABLE memberships ADD COLUMN color VARCHAR(7);

-- Auto-assign distinct colors to existing staff (deterministic via row order)
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY tenant_id ORDER BY created_at) AS rn
  FROM memberships
  WHERE role IN ('POS_STAFF', 'POS_MANAGER', 'POS_ADMIN', 'TENANT_OWNER')
)
UPDATE memberships m
SET color = (ARRAY[
  '#3B82F6', -- blue
  '#10B981', -- green
  '#F59E0B', -- amber
  '#EF4444', -- red
  '#8B5CF6', -- purple
  '#EC4899', -- pink
  '#06B6D4', -- cyan
  '#84CC16', -- lime
  '#F97316', -- orange
  '#6366F1', -- indigo
  '#14B8A6', -- teal
  '#A855F7'  -- violet
])[((n.rn - 1) % 12) + 1]
FROM numbered n
WHERE m.id = n.id;

-- Tables: live state pointers
ALTER TABLE tables ADD COLUMN current_server_id UUID REFERENCES memberships(id) ON DELETE SET NULL;
ALTER TABLE tables ADD COLUMN seated_at TIMESTAMPTZ;
ALTER TABLE tables ADD COLUMN guest_count INT;
ALTER TABLE tables ADD COLUMN last_status_change_at TIMESTAMPTZ;

-- Backfill last_status_change_at for existing rows
UPDATE tables SET last_status_change_at = updated_at WHERE last_status_change_at IS NULL;

-- Trigger: bump last_status_change_at whenever status changes
CREATE OR REPLACE FUNCTION trg_bump_status_change_time()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.last_status_change_at = NOW();
    -- Also clear seated_at and guest_count when going back to AVAILABLE
    IF NEW.status = 'AVAILABLE' THEN
      NEW.seated_at = NULL;
      NEW.guest_count = NULL;
      NEW.current_server_id = NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tables_status_change
  BEFORE UPDATE ON tables
  FOR EACH ROW EXECUTE FUNCTION trg_bump_status_change_time();

-- Index for live floor view queries (filter by location + active)
CREATE INDEX idx_tables_live_status
  ON tables(location_id, status, last_status_change_at DESC)
  WHERE is_active = true;

COMMIT;

-- =====================================================================
-- VERIFY:
-- =====================================================================
-- \d tables
-- \d memberships
-- SELECT id, first_name, role, color FROM memberships LIMIT 10;


-- =====================================================================
-- ROLLBACK:
-- =====================================================================
-- BEGIN;
-- DROP INDEX IF EXISTS idx_tables_live_status;
-- DROP TRIGGER IF EXISTS trg_tables_status_change ON tables;
-- DROP FUNCTION IF EXISTS trg_bump_status_change_time();
-- ALTER TABLE tables DROP COLUMN IF EXISTS last_status_change_at;
-- ALTER TABLE tables DROP COLUMN IF EXISTS guest_count;
-- ALTER TABLE tables DROP COLUMN IF EXISTS seated_at;
-- ALTER TABLE tables DROP COLUMN IF EXISTS current_server_id;
-- ALTER TABLE memberships DROP COLUMN IF EXISTS color;
-- COMMIT;
