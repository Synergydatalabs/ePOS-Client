-- ============================================================================
-- Appointment reminders + cancellation window — Phase E R4
-- Date: 2026-07-31
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. orders.reminder_24h_sent_at / _12h / _4h — idempotency stamps for
--      the appointment reminder cron. Matches the pattern reservations
--      already use.
--   2. reservations.reminder_12h_sent_at / _4h — the reservation flow
--      historically had 24h + 2h; we're aligning both flows on
--      24h / 12h / 4h so operators only need to think about one policy.
--      Legacy reminder_2h_sent_at stays (harmless — the new sender
--      picks the 4h column).
--   3. tenant_settings.cancellation_window_minutes (default 30) — how
--      close to a booking the customer can still cancel with a full
--      refund. Round 3b/4b will wire this into the refund path.
--
-- Idempotent — every ADD COLUMN guarded.
-- ============================================================================

BEGIN;

-- 1. Order (appointments)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at TIMESTAMPTZ;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS reminder_12h_sent_at TIMESTAMPTZ;
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS reminder_4h_sent_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_appointment_reminder_scan
  ON orders(appointment_date, appointment_time)
  WHERE order_type = 'APPOINTMENT'
    AND (reminder_24h_sent_at IS NULL
         OR reminder_12h_sent_at IS NULL
         OR reminder_4h_sent_at IS NULL);

-- 2. Reservation
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS reminder_12h_sent_at TIMESTAMPTZ;
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS reminder_4h_sent_at  TIMESTAMPTZ;

-- 3. TenantSettings
ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS cancellation_window_minutes INTEGER
    NOT NULL DEFAULT 30;

COMMIT;
