-- ============================================================================
-- Appointment deposit-required flow — Phase E R6
-- Date: 2026-07-31
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. tenant_settings.require_appointment_deposit  bool default false
--   2. tenant_settings.appointment_deposit_type     'PERCENT' | 'FIXED'
--   3. tenant_settings.appointment_deposit_value    int (percent 0..100
--      when type=PERCENT; cents when type=FIXED)
--
-- Only applies to appointments booked via the PUBLIC flow — POS-created
-- appointments are pay-at-service (staff is with the customer).
--
-- Idempotent — guarded ADD COLUMNs.
-- ============================================================================

BEGIN;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS require_appointment_deposit BOOLEAN
    NOT NULL DEFAULT false;

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS appointment_deposit_type VARCHAR(10)
    NOT NULL DEFAULT 'PERCENT';

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS appointment_deposit_value INTEGER
    NOT NULL DEFAULT 25;

-- Sanity check on type — reject anything but our two enum-style values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_settings_deposit_type_check'
  ) THEN
    ALTER TABLE tenant_settings
      ADD CONSTRAINT tenant_settings_deposit_type_check
      CHECK (appointment_deposit_type IN ('PERCENT', 'FIXED'));
  END IF;
END $$;

COMMIT;
