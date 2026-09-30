-- ============================================================================
-- Supplier Payment Gateway — Phase C schema
-- Date: 2026-07-30
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. Enums: PaymentProcessor, GatewayApplicationStatus, SupplierProcessorStatus
--   2. payment_gateway_applications — supplier KYB submission + admin queue
--   3. supplier_processors — active gateway credentials per supplier
--
-- Sensitive fields (tax_id_enc, bank_info_enc, beneficial_owners_enc,
-- credentials_enc) hold AES-GCM ciphertext as base64 Text. Encryption key
-- lives in KYB_ENCRYPTION_KEY env var — see src/lib/kyb-crypto.ts.
--
-- Idempotent — every CREATE / ALTER guarded with IF NOT EXISTS / DO block.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enums (CamelCase — matches Prisma's default type naming)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentProcessor') THEN
    CREATE TYPE "PaymentProcessor" AS ENUM ('GP', 'MONERIS', 'STRIPE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'GatewayApplicationStatus') THEN
    CREATE TYPE "GatewayApplicationStatus" AS ENUM (
      'DRAFT',
      'SUBMITTED',
      'IN_REVIEW',
      'FORWARDED',
      'INFO_REQUESTED',
      'APPROVED',
      'REJECTED'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SupplierProcessorStatus') THEN
    CREATE TYPE "SupplierProcessorStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. payment_gateway_applications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS payment_gateway_applications (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  target_processor              "PaymentProcessor",
  status                        "GatewayApplicationStatus" NOT NULL DEFAULT 'SUBMITTED',

  -- Business info (plaintext — reviewer needs at-a-glance queue rows)
  legal_name                    VARCHAR(255) NOT NULL,
  dba_name                      VARCHAR(255),
  business_type_name            VARCHAR(50),
  incorporation_date            DATE,
  incorporation_region          VARCHAR(100),
  business_address              JSONB,
  website_url                   VARCHAR(500),
  mcc_code                      VARCHAR(10),

  -- Financial projections
  projected_monthly_volume_cents INT,
  average_ticket_cents          INT,
  currency                      VARCHAR(3) NOT NULL DEFAULT 'CAD',

  -- Sensitive KYB (AES-GCM ciphertext, base64 Text — see kyb-crypto.ts)
  tax_id_enc                    TEXT,
  bank_info_enc                 TEXT,
  beneficial_owners_enc         TEXT,

  -- Signer / consent
  signer_name                   VARCHAR(150),
  signer_title                  VARCHAR(100),
  signer_email                  VARCHAR(255),
  signer_consented_at           TIMESTAMPTZ,

  -- Admin review
  admin_notes                   TEXT,
  reviewed_by_admin_email       VARCHAR(255),
  forwarded_to_email            VARCHAR(255),
  processor_reference_id        VARCHAR(100),
  rejection_reason              TEXT,
  info_requested                TEXT,

  -- Lifecycle timestamps
  submitted_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  forwarded_at                  TIMESTAMPTZ,
  info_requested_at             TIMESTAMPTZ,
  approved_at                   TIMESTAMPTZ,
  rejected_at                   TIMESTAMPTZ,
  last_admin_action_at          TIMESTAMPTZ,

  created_by_membership_id      UUID REFERENCES memberships(id) ON DELETE SET NULL,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT pga_projected_volume_nonneg CHECK (
    projected_monthly_volume_cents IS NULL OR projected_monthly_volume_cents >= 0
  ),
  CONSTRAINT pga_avg_ticket_nonneg CHECK (
    average_ticket_cents IS NULL OR average_ticket_cents >= 0
  )
);

CREATE INDEX IF NOT EXISTS idx_pga_supplier_status
  ON payment_gateway_applications(supplier_tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_pga_status_submitted_desc
  ON payment_gateway_applications(status, submitted_at DESC);

-- ---------------------------------------------------------------------------
-- 3. supplier_processors
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS supplier_processors (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  application_id       UUID UNIQUE REFERENCES payment_gateway_applications(id) ON DELETE SET NULL,

  processor            "PaymentProcessor" NOT NULL,
  external_mid         VARCHAR(100) NOT NULL,

  -- Encrypted JSON of API credentials — shape depends on processor.
  credentials_enc      TEXT NOT NULL,

  fee_schedule_json    JSONB,

  status               "SupplierProcessorStatus" NOT NULL DEFAULT 'PENDING',
  activated_at         TIMESTAMPTZ,
  suspended_at         TIMESTAMPTZ,
  suspension_reason    TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per (supplier, processor) pair. Re-onboarding UPDATEs; never
  -- inserts a duplicate.
  UNIQUE (supplier_tenant_id, processor)
);

CREATE INDEX IF NOT EXISTS idx_supplier_processors_status
  ON supplier_processors(supplier_tenant_id, status);

COMMIT;
