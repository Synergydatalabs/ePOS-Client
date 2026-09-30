-- =====================================================================
-- Phase 3b Migration: Restaurant Media Items (photos, videos, 360°)
-- Date: 2026-05-18
--
-- Adds:
--   - media_type enum (PHOTO, VIDEO, PANORAMA_360)
--   - media_items table — per-location media library
--
-- This table is the source of truth for restaurant-side media that
-- shows up on:
--   - Admin gallery (manage photos/videos)
--   - Customer-facing reservation page (Phase 6)
--   - 360° virtual tour (Phase 3c — panoramas become tour scenes)
-- =====================================================================

BEGIN;

CREATE TYPE media_type AS ENUM (
  'PHOTO',           -- regular image (JPG, PNG, WebP)
  'VIDEO',           -- restaurant walkthrough video (MP4)
  'PANORAMA_360'     -- equirectangular 360° photo (used by virtual tour viewer)
);

CREATE TABLE media_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id         UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  section_id          UUID REFERENCES sections(id) ON DELETE SET NULL,
                      -- NULL = applies to the whole location
                      -- set = section-specific (e.g. "Patio" gallery only)

  -- Media file
  media_type          media_type NOT NULL,
  s3_key              VARCHAR(500) NOT NULL,
  public_url          VARCHAR(800) NOT NULL,     -- denormalized for fast read
  thumbnail_url       VARCHAR(800),              -- optional, generated for videos
  file_size_bytes     BIGINT,
  width_px            INT,                       -- for images/videos
  height_px           INT,
  duration_seconds    INT,                       -- for videos only

  -- Display metadata
  caption             VARCHAR(500),
  alt_text            VARCHAR(500),              -- accessibility
  display_order       INT NOT NULL DEFAULT 0,
  is_cover            BOOLEAN NOT NULL DEFAULT false,
                      -- one cover per location (enforced by partial unique index)

  -- 360° specific (used when media_type = PANORAMA_360)
  scene_name          VARCHAR(100),              -- "Entrance", "Main Dining" — for navigation
  initial_yaw         REAL DEFAULT 0,            -- starting horizontal angle (-180..180)
  initial_pitch       REAL DEFAULT 0,            -- starting vertical angle (-90..90)
  initial_fov         REAL DEFAULT 90,           -- starting field of view (30..120)

  -- Lifecycle
  is_active           BOOLEAN NOT NULL DEFAULT true,
  uploaded_by_id      UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_media_items_location ON media_items(location_id, display_order);
CREATE INDEX idx_media_items_section ON media_items(section_id) WHERE section_id IS NOT NULL;
CREATE INDEX idx_media_items_type ON media_items(location_id, media_type);
CREATE INDEX idx_media_items_active ON media_items(location_id, is_active) WHERE is_active = true;

-- Only ONE cover photo per location (partial unique index)
CREATE UNIQUE INDEX idx_media_items_one_cover_per_location
  ON media_items(location_id) WHERE is_cover = true;

-- Updated-at trigger
CREATE TRIGGER trg_media_items_updated_at
  BEFORE UPDATE ON media_items
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

COMMIT;

-- =====================================================================
-- VERIFY (run after COMMIT):
-- =====================================================================
-- \d media_items
-- SELECT typname FROM pg_type WHERE typname = 'media_type';
-- \di idx_media_items*


-- =====================================================================
-- ROLLBACK (if needed):
-- =====================================================================
-- BEGIN;
-- DROP TABLE IF EXISTS media_items CASCADE;
-- DROP TYPE IF EXISTS media_type;
-- COMMIT;
