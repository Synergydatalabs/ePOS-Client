-- =====================================================================
-- Phase 1 Migration: Floor Plan + Reservations + S3 Uploads + AI Hooks
-- Date: 2026-05-18
-- Database: itap_pos_dev (Aurora Postgres, ca-central-1)
--
-- HOW TO APPLY:
--   1. Connect to Aurora via psql or your SQL client
--   2. Run this entire file in one transaction
--   3. Verify: \dt floor_plans, sections, reservations, etc.
--   4. On EC2: pull schema.prisma changes from repo, run `npx prisma generate`
--
-- ROLLBACK:
--   See ROLLBACK section at the bottom of this file.
-- =====================================================================

BEGIN;

-- =====================================================================
-- ENUMS
-- =====================================================================

CREATE TYPE table_shape AS ENUM (
  'ROUND', 'SQUARE', 'RECTANGLE', 'BOOTH', 'BAR', 'CUSTOM'
);

CREATE TYPE reservation_status AS ENUM (
  'PENDING_DEPOSIT',  -- created, awaiting payment
  'CONFIRMED',        -- ready to seat
  'ARRIVED',          -- guest checked in, not yet seated
  'SEATED',           -- at table
  'COMPLETED',        -- finished and left
  'NO_SHOW',          -- never arrived
  'CANCELLED'         -- cancelled by guest or restaurant
);

CREATE TYPE reservation_source AS ENUM (
  'WEBSITE', 'GOOGLE', 'PHONE', 'WALK_IN', 'WHATSAPP', 'PARTNER', 'INTERNAL'
);

CREATE TYPE waitlist_status AS ENUM (
  'WAITING',          -- in queue
  'NOTIFIED',         -- SMS sent, awaiting confirm
  'CONFIRMED',        -- guest replied 1
  'SEATED',           -- now at table
  'NO_SHOW',          -- didn't show after notify
  'CANCELLED'         -- guest replied 9 or timed out
);

CREATE TYPE arrival_source AS ENUM (
  'MANUAL',           -- staff entered
  'CAMERA',           -- vision system (Verkada, etc.)
  'QR_SCAN',          -- guest scanned door QR
  'WHATSAPP',         -- guest messaged
  'RESERVATION'       -- linked from booking
);

-- =====================================================================
-- FLOOR PLANS (per location, supports multi-floor restaurants)
-- =====================================================================

CREATE TABLE floor_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name                VARCHAR(100) NOT NULL,                  -- "Main Dining", "Patio", "Mezzanine"
  floor_number        INT NOT NULL DEFAULT 1,                 -- 1, 2, -1 for basement
  display_order       INT NOT NULL DEFAULT 0,
  description         TEXT,

  -- Canvas dimensions (logical units, not pixels)
  canvas_width        INT NOT NULL DEFAULT 1200,
  canvas_height       INT NOT NULL DEFAULT 800,
  grid_size           INT NOT NULL DEFAULT 20,                -- snap-to-grid step
  background_url      VARCHAR(500),                           -- S3 URL of architect drawing
  background_opacity  REAL NOT NULL DEFAULT 0.5,              -- 0..1

  -- Versioning (beats Toast — full rollback)
  current_version     INT NOT NULL DEFAULT 1,
  layout_json         JSONB NOT NULL DEFAULT '{}'::jsonb,     -- current live state
  draft_json          JSONB,                                  -- unsaved changes
  has_unsaved_changes BOOLEAN NOT NULL DEFAULT false,

  is_active           BOOLEAN NOT NULL DEFAULT true,
  is_default          BOOLEAN NOT NULL DEFAULT false,         -- one default per location

  published_at        TIMESTAMPTZ,
  published_by        UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT floor_plans_opacity_range CHECK (background_opacity >= 0 AND background_opacity <= 1)
);

CREATE INDEX idx_floor_plans_location ON floor_plans(location_id);
CREATE INDEX idx_floor_plans_active ON floor_plans(location_id, is_active) WHERE is_active = true;
CREATE UNIQUE INDEX idx_floor_plans_one_default_per_location ON floor_plans(location_id) WHERE is_default = true;

-- Versions: every Save+Publish creates a snapshot for rollback
CREATE TABLE floor_plan_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_plan_id       UUID NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  version_number      INT NOT NULL,
  layout_json         JSONB NOT NULL,
  note                TEXT,                                   -- "Added patio expansion"
  saved_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  saved_by_id         UUID REFERENCES memberships(id) ON DELETE SET NULL,

  CONSTRAINT floor_plan_versions_unique UNIQUE (floor_plan_id, version_number)
);

CREATE INDEX idx_floor_plan_versions_plan ON floor_plan_versions(floor_plan_id, version_number DESC);

-- =====================================================================
-- SECTIONS (color-coded regions within a floor plan, e.g. "Bar Area", "VIP")
-- =====================================================================

CREATE TABLE sections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  floor_plan_id       UUID NOT NULL REFERENCES floor_plans(id) ON DELETE CASCADE,
  name                VARCHAR(100) NOT NULL,                  -- "Bar", "Window Side", "VIP"
  color               VARCHAR(7) NOT NULL DEFAULT '#3B82F6',  -- hex
  display_order       INT NOT NULL DEFAULT 0,

  -- Optional shape definition (freeform polygon — beats Toast's no-region model)
  polygon_json        JSONB,                                  -- [[x,y],[x,y],...] or null = no boundary

  -- Inheritance for tables in this section
  revenue_center      VARCHAR(50),                            -- inherited by member tables
  min_party_size      INT,                                    -- default capacity hint
  max_party_size      INT,

  -- Booking behavior
  is_bookable         BOOLEAN NOT NULL DEFAULT true,
  description         TEXT,                                   -- customer-visible if bookable

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sections_floor_plan ON sections(floor_plan_id, display_order);

-- =====================================================================
-- EXTEND EXISTING `tables` TABLE — add floor plan coordinates + shape
-- (Existing tables continue working; new columns are nullable)
-- =====================================================================

ALTER TABLE tables ADD COLUMN floor_plan_id       UUID REFERENCES floor_plans(id) ON DELETE SET NULL;
ALTER TABLE tables ADD COLUMN section_id          UUID REFERENCES sections(id) ON DELETE SET NULL;
ALTER TABLE tables ADD COLUMN display_label       VARCHAR(50);  -- alt-display vs tableNumber
ALTER TABLE tables ADD COLUMN shape               table_shape NOT NULL DEFAULT 'ROUND';
ALTER TABLE tables ADD COLUMN custom_polygon      JSONB;        -- for shape=CUSTOM
ALTER TABLE tables ADD COLUMN x                   REAL NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN y                   REAL NOT NULL DEFAULT 0;
ALTER TABLE tables ADD COLUMN width               REAL NOT NULL DEFAULT 80;
ALTER TABLE tables ADD COLUMN height              REAL NOT NULL DEFAULT 80;
ALTER TABLE tables ADD COLUMN rotation            REAL NOT NULL DEFAULT 0;  -- degrees
ALTER TABLE tables ADD COLUMN min_party_size      INT NOT NULL DEFAULT 1;
ALTER TABLE tables ADD COLUMN max_party_size      INT;          -- nullable; falls back to capacity
ALTER TABLE tables ADD COLUMN revenue_center      VARCHAR(50);
ALTER TABLE tables ADD COLUMN is_bookable         BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE tables ADD COLUMN z_index             INT NOT NULL DEFAULT 0;   -- stacking order

CREATE INDEX idx_tables_floor_plan ON tables(floor_plan_id);
CREATE INDEX idx_tables_section ON tables(section_id);

-- Backfill max_party_size from capacity for existing rows
UPDATE tables SET max_party_size = capacity WHERE max_party_size IS NULL;

-- =====================================================================
-- GUEST PROFILES (rich CRM — beats Toast's thin guestbook)
-- =====================================================================

CREATE TABLE guest_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Identity
  email               VARCHAR(255),
  phone               VARCHAR(30),
  first_name          VARCHAR(100) NOT NULL,
  last_name           VARCHAR(100),

  -- Visit history (denormalized for fast read)
  visit_count         INT NOT NULL DEFAULT 0,
  last_visit_at       TIMESTAMPTZ,
  first_visit_at      TIMESTAMPTZ,
  lifetime_spend      INT NOT NULL DEFAULT 0,           -- cents
  average_spend       INT NOT NULL DEFAULT 0,           -- cents
  no_show_count       INT NOT NULL DEFAULT 0,
  cancellation_count  INT NOT NULL DEFAULT 0,

  -- Preferences (richer than Toast)
  favorite_server_id  UUID REFERENCES memberships(id) ON DELETE SET NULL,
  preferred_section_id UUID REFERENCES sections(id) ON DELETE SET NULL,
  dietary_restrictions VARCHAR(255)[],                   -- ['vegetarian', 'gluten-free']
  allergies           VARCHAR(255)[],                    -- ['peanuts', 'shellfish']
  alcohol_preferences VARCHAR(255)[],                    -- ['wine', 'beer', 'none']
  special_occasions   JSONB,                             -- [{"type":"birthday","date":"03-15"}]
  notes               TEXT,                              -- free-form

  -- Tags (for segmentation)
  tags                VARCHAR(50)[] NOT NULL DEFAULT '{}', -- ['VIP', 'regular', 'press']

  -- VIP tier (manager-set, used in suggestion algorithms)
  vip_tier            INT NOT NULL DEFAULT 0,            -- 0 = none, 1-3 = bronze/silver/gold

  -- Marketing
  opt_in_marketing    BOOLEAN NOT NULL DEFAULT false,
  opt_in_whatsapp     BOOLEAN NOT NULL DEFAULT false,
  opt_in_sms          BOOLEAN NOT NULL DEFAULT false,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Unique within tenant (phone OR email — at least one required)
  CONSTRAINT guest_profiles_contact_required CHECK (phone IS NOT NULL OR email IS NOT NULL)
);

CREATE UNIQUE INDEX idx_guest_profiles_tenant_phone ON guest_profiles(tenant_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX idx_guest_profiles_tenant_email ON guest_profiles(tenant_id, lower(email)) WHERE email IS NOT NULL;
CREATE INDEX idx_guest_profiles_tenant_last_visit ON guest_profiles(tenant_id, last_visit_at DESC NULLS LAST);
CREATE INDEX idx_guest_profiles_tenant_visits ON guest_profiles(tenant_id, visit_count DESC);

-- =====================================================================
-- RESERVATIONS
-- =====================================================================

CREATE TABLE reservations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  table_id            UUID REFERENCES tables(id) ON DELETE SET NULL,   -- null until seated
  guest_profile_id    UUID REFERENCES guest_profiles(id) ON DELETE SET NULL,

  -- Snapshot (in case guest profile is missing/anonymous)
  customer_name       VARCHAR(200) NOT NULL,
  customer_phone      VARCHAR(30),
  customer_email      VARCHAR(255),
  party_size          INT NOT NULL,

  -- Time
  booked_for          TIMESTAMPTZ NOT NULL,                 -- when guest expects to arrive
  estimated_duration_minutes INT NOT NULL DEFAULT 90,
  hold_expires_at     TIMESTAMPTZ,                          -- 10-min hold during payment

  -- Status
  status              reservation_status NOT NULL DEFAULT 'CONFIRMED',
  source              reservation_source NOT NULL DEFAULT 'WEBSITE',

  -- Context
  special_occasion    VARCHAR(50),                          -- birthday, anniversary, etc.
  notes               TEXT,                                 -- guest-provided
  internal_notes      TEXT,                                 -- staff-only
  guest_tags          VARCHAR(50)[] NOT NULL DEFAULT '{}',  -- snapshot from profile

  -- Money (deposits + cancellation fees)
  deposit_amount      INT,                                   -- cents
  deposit_status      VARCHAR(20),                          -- PENDING, PAID, REFUNDED, FORFEITED
  deposit_payment_id  VARCHAR(100),                         -- GP transaction reference
  cancellation_fee_amount INT,                              -- cents
  cancellation_fee_charged BOOLEAN NOT NULL DEFAULT false,
  card_on_file_token  VARCHAR(255),                         -- GP token for late charges

  -- Communications log
  confirmation_sent_at TIMESTAMPTZ,
  reminder_sent_at    TIMESTAMPTZ,
  whatsapp_thread_id  VARCHAR(100),                         -- link to WA convo

  -- State transitions
  arrived_at          TIMESTAMPTZ,
  seated_at           TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  cancelled_at        TIMESTAMPTZ,
  cancelled_reason    VARCHAR(255),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_id       UUID REFERENCES memberships(id) ON DELETE SET NULL,

  CONSTRAINT reservations_party_positive CHECK (party_size > 0)
);

CREATE INDEX idx_reservations_location_booked ON reservations(location_id, booked_for);
CREATE INDEX idx_reservations_table ON reservations(table_id);
CREATE INDEX idx_reservations_guest ON reservations(guest_profile_id);
CREATE INDEX idx_reservations_status ON reservations(location_id, status);
CREATE INDEX idx_reservations_today ON reservations(location_id, booked_for) WHERE status IN ('CONFIRMED', 'ARRIVED');

-- =====================================================================
-- WAITLIST (walk-ins)
-- =====================================================================

CREATE TABLE waitlist_entries (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  guest_profile_id    UUID REFERENCES guest_profiles(id) ON DELETE SET NULL,

  customer_name       VARCHAR(200) NOT NULL,
  customer_phone      VARCHAR(30) NOT NULL,
  party_size          INT NOT NULL,
  preferred_area      VARCHAR(50),                          -- bar, patio, dining, any
  preferred_section_id UUID REFERENCES sections(id) ON DELETE SET NULL,

  -- Quote
  quoted_wait_minutes INT NOT NULL,                         -- from algorithm
  estimated_seating_at TIMESTAMPTZ,                         -- now + quoted minutes

  -- SMS flow (Toast pattern: reply 1=confirm, 9=cancel)
  sms_sent_at         TIMESTAMPTZ,
  sms_reply_at        TIMESTAMPTZ,
  sms_reply_value     VARCHAR(10),                          -- '1' or '9'

  -- Pre-authorized bar tab (Toast pattern)
  pre_auth_card_token VARCHAR(255),
  pre_auth_amount     INT,                                  -- cents

  status              waitlist_status NOT NULL DEFAULT 'WAITING',
  seated_at_table_id  UUID REFERENCES tables(id) ON DELETE SET NULL,
  seated_at           TIMESTAMPTZ,

  notes               TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT waitlist_party_positive CHECK (party_size > 0)
);

CREATE INDEX idx_waitlist_location_status ON waitlist_entries(location_id, status, created_at);
CREATE INDEX idx_waitlist_active ON waitlist_entries(location_id, created_at) WHERE status IN ('WAITING', 'NOTIFIED', 'CONFIRMED');

-- =====================================================================
-- SECTION TEMPLATES (shift-pattern presets — beats Toast)
-- =====================================================================

CREATE TABLE section_templates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  name                VARCHAR(100) NOT NULL,                -- "Tuesday Lunch", "Friday Dinner"
  day_of_week         INT,                                  -- 0=Sun..6=Sat; null = any day
  shift_label         VARCHAR(50),                          -- 'breakfast', 'lunch', 'dinner'
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_section_templates_location ON section_templates(location_id);

-- Server assignments (per template or per shift instance)
CREATE TABLE server_section_assignments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  template_id         UUID REFERENCES section_templates(id) ON DELETE CASCADE,

  -- Either template-level (template_id set) OR shift-instance (shift_date set)
  shift_date          DATE,
  shift_start_time    TIME,                                 -- '11:00'
  shift_end_time      TIME,                                 -- '16:00'

  section_id          UUID NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  server_id           UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT server_assignment_template_or_shift CHECK (template_id IS NOT NULL OR shift_date IS NOT NULL)
);

CREATE INDEX idx_server_assignments_template ON server_section_assignments(template_id);
CREATE INDEX idx_server_assignments_shift ON server_section_assignments(location_id, shift_date) WHERE shift_date IS NOT NULL;
CREATE INDEX idx_server_assignments_server ON server_section_assignments(server_id);

-- =====================================================================
-- SPECIAL DATES (block-out, holidays, private events)
-- =====================================================================

CREATE TABLE special_dates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  date                DATE NOT NULL,
  label               VARCHAR(100) NOT NULL,                -- "Mother's Day", "Buyout"

  -- What's blocked
  block_reservations  BOOLEAN NOT NULL DEFAULT false,
  block_walkins       BOOLEAN NOT NULL DEFAULT false,
  block_online        BOOLEAN NOT NULL DEFAULT false,

  -- Optional schedule override
  custom_open_time    TIME,
  custom_close_time   TIME,

  -- Public-facing message
  public_message      TEXT,                                  -- "Closed for renovation"

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_special_dates_location_date ON special_dates(location_id, date);

-- =====================================================================
-- GUEST ARRIVAL EVENTS (camera-ready hook for AI table suggestion)
-- =====================================================================

CREATE TABLE guest_arrival_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  arrived_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Detected attributes (manual now, AI-fed later)
  party_size          INT,                                   -- detected count
  source              arrival_source NOT NULL DEFAULT 'MANUAL',

  -- Linked entities (resolved by staff/system)
  reservation_id      UUID REFERENCES reservations(id) ON DELETE SET NULL,
  waitlist_entry_id   UUID REFERENCES waitlist_entries(id) ON DELETE SET NULL,
  guest_profile_id    UUID REFERENCES guest_profiles(id) ON DELETE SET NULL,

  -- Camera-specific fields (future use)
  camera_id           VARCHAR(100),
  detection_confidence REAL,                                  -- 0..1 from vision model
  face_recognition_score REAL,                                -- 0..1 if matched to profile
  raw_payload         JSONB,                                  -- vendor-specific data

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_arrivals_location_time ON guest_arrival_events(location_id, arrived_at DESC);
CREATE INDEX idx_arrivals_reservation ON guest_arrival_events(reservation_id);
CREATE INDEX idx_arrivals_waitlist ON guest_arrival_events(waitlist_entry_id);

-- =====================================================================
-- UPLOADED FILES (S3 metadata + tenant isolation tracking)
-- =====================================================================

CREATE TABLE uploaded_files (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uploaded_by_id      UUID REFERENCES memberships(id) ON DELETE SET NULL,

  -- S3 location
  s3_bucket           VARCHAR(255) NOT NULL,
  s3_key              VARCHAR(500) NOT NULL,                -- <tenantId>/<resourceType>/<filename>
  s3_etag             VARCHAR(100),
  s3_version_id       VARCHAR(100),

  -- File metadata
  filename            VARCHAR(255) NOT NULL,                 -- original filename
  mime_type           VARCHAR(100) NOT NULL,
  size_bytes          BIGINT NOT NULL,
  width_px            INT,                                   -- for images
  height_px           INT,                                   -- for images

  -- Usage classification
  resource_type       VARCHAR(50) NOT NULL,                 -- 'product', 'category', 'floor_plan_bg', 'logo', etc.
  resource_id         UUID,                                  -- nullable; what entity references this file
  is_public           BOOLEAN NOT NULL DEFAULT true,         -- false = requires signed URL

  -- Lifecycle
  upload_status       VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, COMPLETED, FAILED
  uploaded_at         TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,                           -- soft delete

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uploaded_files_size_positive CHECK (size_bytes >= 0),
  CONSTRAINT uploaded_files_s3_key_unique UNIQUE (s3_bucket, s3_key)
);

CREATE INDEX idx_uploaded_files_tenant ON uploaded_files(tenant_id, resource_type);
CREATE INDEX idx_uploaded_files_resource ON uploaded_files(resource_type, resource_id);
CREATE INDEX idx_uploaded_files_status ON uploaded_files(upload_status) WHERE upload_status = 'PENDING';

-- Tenant isolation invariant: s3_key MUST start with tenant_id
-- (Enforced in application layer; this is a safety net trigger)
CREATE OR REPLACE FUNCTION enforce_s3_tenant_isolation()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.s3_key NOT LIKE (NEW.tenant_id::text || '/%') THEN
    RAISE EXCEPTION 'S3 key % must start with tenant_id %', NEW.s3_key, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enforce_s3_tenant_isolation
  BEFORE INSERT OR UPDATE ON uploaded_files
  FOR EACH ROW EXECUTE FUNCTION enforce_s3_tenant_isolation();

-- =====================================================================
-- updated_at TRIGGER (reusable across all new tables)
-- =====================================================================

CREATE OR REPLACE FUNCTION trg_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'floor_plans', 'sections', 'guest_profiles', 'reservations',
    'waitlist_entries', 'section_templates', 'server_section_assignments',
    'special_dates', 'uploaded_files'
  ] LOOP
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at()', t, t);
  END LOOP;
END $$;

COMMIT;

-- =====================================================================
-- POST-MIGRATION VERIFICATION (run manually after COMMIT)
-- =====================================================================
-- \dt floor_plans sections reservations waitlist_entries guest_profiles
-- \dt section_templates server_section_assignments special_dates
-- \dt guest_arrival_events uploaded_files
-- \d tables  -- verify new columns added
-- SELECT COUNT(*) FROM tables WHERE max_party_size IS NULL;  -- should be 0


-- =====================================================================
-- ROLLBACK SCRIPT (run if you need to undo)
-- =====================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS uploaded_files CASCADE;
-- DROP TABLE IF EXISTS guest_arrival_events CASCADE;
-- DROP TABLE IF EXISTS special_dates CASCADE;
-- DROP TABLE IF EXISTS server_section_assignments CASCADE;
-- DROP TABLE IF EXISTS section_templates CASCADE;
-- DROP TABLE IF EXISTS waitlist_entries CASCADE;
-- DROP TABLE IF EXISTS reservations CASCADE;
-- DROP TABLE IF EXISTS guest_profiles CASCADE;
-- DROP TABLE IF EXISTS sections CASCADE;
-- DROP TABLE IF EXISTS floor_plan_versions CASCADE;
-- DROP TABLE IF EXISTS floor_plans CASCADE;
-- ALTER TABLE tables DROP COLUMN z_index;
-- ALTER TABLE tables DROP COLUMN is_bookable;
-- ALTER TABLE tables DROP COLUMN revenue_center;
-- ALTER TABLE tables DROP COLUMN max_party_size;
-- ALTER TABLE tables DROP COLUMN min_party_size;
-- ALTER TABLE tables DROP COLUMN rotation;
-- ALTER TABLE tables DROP COLUMN height;
-- ALTER TABLE tables DROP COLUMN width;
-- ALTER TABLE tables DROP COLUMN y;
-- ALTER TABLE tables DROP COLUMN x;
-- ALTER TABLE tables DROP COLUMN custom_polygon;
-- ALTER TABLE tables DROP COLUMN shape;
-- ALTER TABLE tables DROP COLUMN display_label;
-- ALTER TABLE tables DROP COLUMN section_id;
-- ALTER TABLE tables DROP COLUMN floor_plan_id;
-- DROP TYPE arrival_source;
-- DROP TYPE waitlist_status;
-- DROP TYPE reservation_source;
-- DROP TYPE reservation_status;
-- DROP TYPE table_shape;
-- DROP FUNCTION IF EXISTS enforce_s3_tenant_isolation();
-- COMMIT;
