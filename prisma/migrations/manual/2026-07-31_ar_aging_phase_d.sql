-- ============================================================================
-- Supplier statements + AR aging — Phase D #75
-- Date: 2026-07-31
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. supplier_profiles.default_net_terms_days — how many days after
--      submission a PO is considered "due". Default 30 (Net 30, industry
--      standard). Suppliers on cash-basis can set 0.
--
-- The aging calculation itself is DERIVED at query time:
--   days_outstanding = today - (submittedAt + defaultNetTermsDays)
--   bucket           = 0..30 / 31..60 / 61..90 / 90+
-- No stored aging table — recompute every time so the report is always
-- fresh.
--
-- Idempotent — guarded ADD COLUMN.
-- ============================================================================

BEGIN;

ALTER TABLE supplier_profiles
  ADD COLUMN IF NOT EXISTS default_net_terms_days INTEGER NOT NULL DEFAULT 30;

COMMIT;
