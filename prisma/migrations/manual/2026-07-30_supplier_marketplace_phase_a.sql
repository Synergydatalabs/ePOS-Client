-- ============================================================================
-- Supplier Marketplace — Phase A schema
-- Date: 2026-07-30
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds the foundation for the supplier marketplace:
--   1. supplier_profiles  — one-to-one with tenants where business_type='supplier'
--   2. supplier_invites   — invite tokens sent by merchants to suppliers
--   3. supplier_merchant_relationships — accepted supplier ↔ merchant links
--
-- Also adds a linked_tenant_id column on the existing suppliers table
-- (per-tenant INVENTORY reference records) so a local supplier row can
-- point at the marketplace tenant once an invite is accepted.
--
-- Enum names use CamelCase to match Prisma's default naming so
-- prisma.generate can bind to them without renames.
-- Safe to re-run — every step is idempotent (IF NOT EXISTS / DO block).
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupplierInviteStatus') THEN
    CREATE TYPE "SupplierInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'CANCELLED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupplierRelationshipStatus') THEN
    CREATE TYPE "SupplierRelationshipStatus" AS ENUM ('ACTIVE', 'PAUSED', 'TERMINATED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupplierRelationshipSource') THEN
    CREATE TYPE "SupplierRelationshipSource" AS ENUM ('INVITE', 'MARKETPLACE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupplierOnboardingStatus') THEN
    CREATE TYPE "SupplierOnboardingStatus" AS ENUM ('NEW', 'CATALOG_SETUP', 'GATEWAY_PENDING', 'ACTIVE', 'SUSPENDED');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Extend existing `suppliers` table with linked_tenant_id
--    (nullable — a local supplier row can exist without a marketplace link)
-- ---------------------------------------------------------------------------

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS linked_tenant_id UUID
    REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_suppliers_linked_tenant_id
  ON suppliers(linked_tenant_id)
  WHERE linked_tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. supplier_profiles — one row per supplier tenant
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,

  legal_name          VARCHAR(255),
  display_name        VARCHAR(255),
  website_url         VARCHAR(500),
  contact_email       VARCHAR(255),
  contact_phone       VARCHAR(30),
  about_text          TEXT,

  warehouse_address   JSONB,
  categories          TEXT[] NOT NULL DEFAULT '{}',

  min_order_cents     INT NOT NULL DEFAULT 0,
  default_lead_days   INT NOT NULL DEFAULT 3,
  currency            VARCHAR(3) NOT NULL DEFAULT 'CAD',

  is_public           BOOLEAN NOT NULL DEFAULT false,
  onboarding_status   "SupplierOnboardingStatus" NOT NULL DEFAULT 'NEW',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_profiles_is_public
  ON supplier_profiles(is_public) WHERE is_public = true;

CREATE INDEX IF NOT EXISTS idx_supplier_profiles_onboarding_status
  ON supplier_profiles(onboarding_status);

-- ---------------------------------------------------------------------------
-- 4. supplier_invites — one row per merchant → email invite
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_invites (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_membership_id   UUID REFERENCES memberships(id) ON DELETE SET NULL,

  email                VARCHAR(255) NOT NULL,
  company_name         VARCHAR(255),
  contact_name         VARCHAR(100),
  phone                VARCHAR(30),
  message              TEXT,

  token                VARCHAR(64) NOT NULL UNIQUE,

  status               "SupplierInviteStatus" NOT NULL DEFAULT 'PENDING',
  expires_at           TIMESTAMPTZ NOT NULL,
  accepted_at          TIMESTAMPTZ,

  accepted_tenant_id   UUID REFERENCES tenants(id) ON DELETE SET NULL,
  local_supplier_id    UUID REFERENCES suppliers(id) ON DELETE SET NULL,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_invites_from_tenant_status
  ON supplier_invites(from_tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_supplier_invites_email
  ON supplier_invites(email);

-- ---------------------------------------------------------------------------
-- 5. supplier_merchant_relationships — accepted links
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_merchant_relationships (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  merchant_tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  status              "SupplierRelationshipStatus" NOT NULL DEFAULT 'ACTIVE',
  source              "SupplierRelationshipSource" NOT NULL DEFAULT 'INVITE',
  invite_id           UUID REFERENCES supplier_invites(id) ON DELETE SET NULL,

  first_order_at      TIMESTAMPTZ,
  last_order_at       TIMESTAMPTZ,
  total_orders        INT NOT NULL DEFAULT 0,
  total_spent_cents   INT NOT NULL DEFAULT 0,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A merchant can only have ONE relationship row per supplier. Reactivation
  -- flips status; it does not create a duplicate row.
  UNIQUE (supplier_tenant_id, merchant_tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_smr_supplier_status
  ON supplier_merchant_relationships(supplier_tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_smr_merchant_status
  ON supplier_merchant_relationships(merchant_tenant_id, status);

COMMIT;
