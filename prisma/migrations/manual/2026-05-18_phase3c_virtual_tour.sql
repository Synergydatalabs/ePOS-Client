-- =====================================================================
-- Phase 3c Migration: Virtual Tour — hotspots + scene defaults
-- Date: 2026-05-18
--
-- Builds on Phase 3b's media_items table. A 360° panorama becomes a
-- "scene" when it has scene_name set + tour-relevant flags. Hotspots
-- live in a separate table and link scenes together (scene-to-scene
-- navigation) or link to tables (book-this-table inside the tour).
--
-- We also generate a public slug per location so the embeddable customer
-- tour URL is shareable: /tour/<slug>
-- =====================================================================

BEGIN;

-- Hotspot type — what happens when user clicks it inside the 360° view
CREATE TYPE hotspot_type AS ENUM (
  'SCENE_LINK',    -- click → navigate to another scene
  'TABLE_LINK',    -- click → opens reservation flow for that table
  'INFO',          -- click → shows a tooltip / popup with text
  'EXTERNAL_URL'   -- click → opens external link (e.g. menu PDF)
);

CREATE TABLE tour_hotspots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scene_media_id      UUID NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
                      -- the 360° panorama this hotspot is placed inside

  hotspot_type        hotspot_type NOT NULL,

  -- Position in 360° space (Pannellum spherical coords)
  yaw                 REAL NOT NULL,        -- horizontal angle (-180..180)
  pitch               REAL NOT NULL,        -- vertical angle (-90..90)

  -- Display
  label               VARCHAR(200) NOT NULL,
  icon_url            VARCHAR(500),         -- optional custom icon

  -- Targets (one of these is set depending on hotspot_type)
  target_scene_media_id UUID REFERENCES media_items(id) ON DELETE SET NULL,
                        -- for SCENE_LINK
  target_table_id     UUID REFERENCES tables(id) ON DELETE SET NULL,
                        -- for TABLE_LINK
  external_url        VARCHAR(800),
                        -- for EXTERNAL_URL

  -- For navigation hotspots — initial view angle when arriving at target scene
  target_yaw          REAL,
  target_pitch        REAL,

  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Validation: hotspot_type matches the target field that's populated
  CONSTRAINT hotspot_target_consistency CHECK (
    (hotspot_type = 'SCENE_LINK' AND target_scene_media_id IS NOT NULL) OR
    (hotspot_type = 'TABLE_LINK' AND target_table_id IS NOT NULL) OR
    (hotspot_type = 'INFO') OR
    (hotspot_type = 'EXTERNAL_URL' AND external_url IS NOT NULL)
  )
);

CREATE INDEX idx_tour_hotspots_scene ON tour_hotspots(scene_media_id) WHERE is_active = true;
CREATE INDEX idx_tour_hotspots_target_scene ON tour_hotspots(target_scene_media_id) WHERE target_scene_media_id IS NOT NULL;
CREATE INDEX idx_tour_hotspots_target_table ON tour_hotspots(target_table_id) WHERE target_table_id IS NOT NULL;

CREATE TRIGGER trg_tour_hotspots_updated_at
  BEFORE UPDATE ON tour_hotspots
  FOR EACH ROW EXECUTE FUNCTION trg_set_updated_at();

-- =====================================================================
-- Add is_default_scene to media_items
-- (one default scene per location — that's where the tour starts)
-- =====================================================================

ALTER TABLE media_items ADD COLUMN is_default_scene BOOLEAN NOT NULL DEFAULT false;

-- Partial unique index: only ONE default scene per location among 360° items
CREATE UNIQUE INDEX idx_media_items_one_default_scene_per_location
  ON media_items(location_id)
  WHERE is_default_scene = true AND media_type = 'PANORAMA_360' AND is_active = true;

-- =====================================================================
-- Add public_tour_slug to locations (used by /tour/<slug> embeddable URL)
-- =====================================================================

ALTER TABLE locations ADD COLUMN public_tour_slug VARCHAR(100);

-- Auto-generate from existing location names (simple kebab-case)
UPDATE locations
SET public_tour_slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'))
WHERE public_tour_slug IS NULL;

-- Strip leading/trailing dashes from the auto-generated slugs
UPDATE locations
SET public_tour_slug = regexp_replace(public_tour_slug, '^-+|-+$', '', 'g')
WHERE public_tour_slug IS NOT NULL;

-- For dupes across tenants (unlikely but possible), suffix with id prefix
WITH dupes AS (
  SELECT id, public_tour_slug,
         row_number() OVER (PARTITION BY public_tour_slug ORDER BY created_at) AS rn
  FROM locations
)
UPDATE locations l
SET public_tour_slug = l.public_tour_slug || '-' || substring(l.id::text, 1, 8)
FROM dupes d
WHERE l.id = d.id AND d.rn > 1;

-- Now make it unique
ALTER TABLE locations ALTER COLUMN public_tour_slug SET NOT NULL;
CREATE UNIQUE INDEX idx_locations_public_tour_slug ON locations(public_tour_slug);

COMMIT;

-- =====================================================================
-- VERIFY (run after COMMIT):
-- =====================================================================
-- \d tour_hotspots
-- \d media_items   -- should now show is_default_scene column
-- \d locations     -- should now show public_tour_slug column
-- SELECT typname FROM pg_type WHERE typname = 'hotspot_type';
-- SELECT name, public_tour_slug FROM locations;


-- =====================================================================
-- ROLLBACK:
-- =====================================================================
-- BEGIN;
-- DROP INDEX IF EXISTS idx_locations_public_tour_slug;
-- ALTER TABLE locations DROP COLUMN IF EXISTS public_tour_slug;
-- DROP INDEX IF EXISTS idx_media_items_one_default_scene_per_location;
-- ALTER TABLE media_items DROP COLUMN IF EXISTS is_default_scene;
-- DROP TABLE IF EXISTS tour_hotspots CASCADE;
-- DROP TYPE IF EXISTS hotspot_type;
-- COMMIT;
