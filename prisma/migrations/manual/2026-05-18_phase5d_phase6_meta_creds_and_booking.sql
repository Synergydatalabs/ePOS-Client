-- ============================================================================
-- Phase 5d + Phase 6 migration — 2026-05-18
--
-- Phase 5d: per-tenant BYO Meta WhatsApp credentials + scheduled reminders
-- Phase 6:  public customer booking page (no schema change beyond a few flags)
--
-- This script is idempotent (IF NOT EXISTS guards). Safe to re-run.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Tenant: per-tenant Meta WhatsApp credentials
-- ----------------------------------------------------------------------------
-- All token-shaped values are stored ENCRYPTED with AES-256-GCM, using a
-- master key set in env (META_CREDENTIAL_ENC_KEY, 32 raw bytes base64-encoded).
-- The phone_number_id is NOT secret (it's a Meta routing handle that
-- appears in inbound webhook payloads) — we leave it plaintext so we can
-- match `phone_number_id` from the webhook to a tenant via index.
-- ----------------------------------------------------------------------------

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS meta_phone_number_id              VARCHAR(64),
  ADD COLUMN IF NOT EXISTS meta_waba_id                       VARCHAR(64),
  ADD COLUMN IF NOT EXISTS meta_access_token_enc              TEXT,
  ADD COLUMN IF NOT EXISTS meta_app_secret_enc                TEXT,
  ADD COLUMN IF NOT EXISTS meta_webhook_verify_token_enc      TEXT,
  ADD COLUMN IF NOT EXISTS meta_display_name                  VARCHAR(255),
  ADD COLUMN IF NOT EXISTS meta_connection_type               VARCHAR(20),
    -- one of: 'manual' | 'embedded' | 'shared' (null = uses shared env creds)
  ADD COLUMN IF NOT EXISTS meta_connected_at                  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS meta_last_health_check_at          TIMESTAMP,
  ADD COLUMN IF NOT EXISTS meta_health_status                 VARCHAR(20);
    -- one of: 'healthy' | 'expiring' | 'revoked' | 'unknown'

-- Phone number ID is the inbound-routing key — must be fast to look up.
CREATE INDEX IF NOT EXISTS idx_tenants_meta_phone_number_id
  ON tenants(meta_phone_number_id)
  WHERE meta_phone_number_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2) Location: public booking page flags + operating hours
-- ----------------------------------------------------------------------------
-- public_booking_enabled allows hiding a single location's booking page
-- without disabling the whole tenant. Per-location booking config falls
-- back to TenantSettings if null.
--
-- operating_hours is a JSON column with shape:
-- {
--   "mon": { "open": "11:00", "close": "22:00", "closed": false },
--   "tue": { ... },
--   ...
--   "sun": { "open": "11:00", "close": "22:00", "closed": false }
-- }
-- Falls back to default 11:00–22:00 if null.
-- ----------------------------------------------------------------------------

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS public_booking_enabled  BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS public_booking_slug     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS operating_hours         JSONB,
  ADD COLUMN IF NOT EXISTS booking_lead_minutes    INT DEFAULT 60,
    -- minimum hours-in-future a booking can be placed (default 1 hr)
  ADD COLUMN IF NOT EXISTS booking_slot_minutes    INT DEFAULT 30,
    -- granularity of bookable slots (e.g., :00, :30 if 30)
  ADD COLUMN IF NOT EXISTS booking_max_party_size  INT DEFAULT 12,
    -- larger parties must call (or use a separate form)
  ADD COLUMN IF NOT EXISTS booking_hero_media_id   UUID;
    -- specific MediaItem to feature on booking landing; null = first PHOTO

-- public_booking_slug defaults to the location's public_tour_slug so
-- existing locations get usable URLs immediately. Run as a one-shot
-- backfill; new rows can populate it via app code.
UPDATE locations
   SET public_booking_slug = public_tour_slug
 WHERE public_booking_slug IS NULL
   AND public_tour_slug IS NOT NULL;

-- Make it unique per tenant once backfilled. Partial unique index
-- so locations without a slug yet don't clash.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_locations_tenant_booking_slug
  ON locations(tenant_id, public_booking_slug)
  WHERE public_booking_slug IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3) Tenant: top-level public booking toggle + tagline
-- ----------------------------------------------------------------------------

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS public_booking_enabled  BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS booking_tagline         VARCHAR(200);

-- ----------------------------------------------------------------------------
-- 4) Reservation reminder tracking
-- ----------------------------------------------------------------------------
-- reminder_sent_at already exists from Phase 1a. Add a second column so we
-- can distinguish between the 24-hour reminder and the 2-hour reminder.
-- ----------------------------------------------------------------------------

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at  TIMESTAMP,
  ADD COLUMN IF NOT EXISTS reminder_2h_sent_at   TIMESTAMP;

-- Index for the cron job's fast "find upcoming reservations" scan
CREATE INDEX IF NOT EXISTS idx_reservations_booked_for_status
  ON reservations(booked_for, status)
  WHERE status IN ('CONFIRMED', 'PENDING_DEPOSIT');

-- ----------------------------------------------------------------------------
-- 5) Conversation messages inbox (Phase 5d-future, schema only)
-- ----------------------------------------------------------------------------
-- All inbound SMS/WhatsApp that don't match a waitlist 1/9 reply land here
-- so staff can see/respond from the admin portal in a later phase. Schema
-- in this migration; UI in a future phase.
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS conversation_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id     UUID REFERENCES locations(id) ON DELETE SET NULL,
  channel         VARCHAR(20) NOT NULL,           -- 'SMS' | 'WHATSAPP'
  direction       VARCHAR(10) NOT NULL,           -- 'INBOUND' | 'OUTBOUND'
  from_phone      VARCHAR(30) NOT NULL,
  to_phone        VARCHAR(30) NOT NULL,
  body            TEXT,
  provider_msg_id VARCHAR(255),                   -- Meta message id or Twilio SID
  related_kind    VARCHAR(30),                    -- 'waitlist' | 'reservation' | null
  related_id      UUID,
  raw_payload     JSONB,                          -- the full webhook payload for audit
  read_at         TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conv_msgs_tenant_created
  ON conversation_messages(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conv_msgs_phone
  ON conversation_messages(from_phone, to_phone);

-- ----------------------------------------------------------------------------
-- 6) Done.
-- ----------------------------------------------------------------------------

COMMIT;

-- Sanity check queries (run AFTER commit, separately, for verification):
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'tenants' AND column_name LIKE 'meta%';
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'locations' AND column_name LIKE 'booking%';
-- SELECT COUNT(*) AS backfilled FROM locations WHERE public_booking_slug IS NOT NULL;
