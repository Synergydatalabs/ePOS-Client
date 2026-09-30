-- ============================================================================
-- Reservations Phase E — Round 2
-- Date: 2026-07-31
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds two TenantSettings columns:
--   1. party_size_duration_map — JSON, party-size buckets → seating minutes.
--      Default matrix mirrors industry standard:
--        1-2 guests → 60 min
--        3-4 guests → 90 min
--        5-6 guests → 120 min
--        7+ guests  → 150 min
--   2. reservation_turn_buffer_minutes — buffer between one booking's
--      end and the next booking's start (cleanup / turn time). Default 15.
--
-- Both are consumed by the reservation create endpoint when the client
-- doesn't send an explicit duration, and by the overbooking check.
--
-- Idempotent — guarded ADD COLUMNs.
-- ============================================================================

BEGIN;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS party_size_duration_map JSONB
    NOT NULL DEFAULT '{"1-2": 60, "3-4": 90, "5-6": 120, "7+": 150}'::jsonb;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS reservation_turn_buffer_minutes INTEGER
    NOT NULL DEFAULT 15;

COMMIT;
