-- =============================================================================
-- Phase I #4 (2026-09-11) — Tenant approval + verification flow.
--
-- Signup on any of our platforms (partner, supplier, ride) now lands in
-- PENDING_APPROVAL. The applicant must:
--   1. Verify their email with a 6-digit OTP
--   2. Verify their phone with a 6-digit OTP (WhatsApp first, SMS fallback)
--   3. Wait for admin review + approval in tapapp-admin
--
-- Only then does tenant.status flip to ACTIVE and the portal unlocks.
-- Login is NOT blocked for non-ACTIVE tenants — instead the portal layout
-- shows a state-specific "Under review / Verify your email / Rejected"
-- screen and all feature routes stay disabled.
--
-- IMPORTANT: existing tenants are untouched — they stay ACTIVE. This
-- migration adds capability, it does NOT retroactively require existing
-- tenants to re-verify. Grandfathering is intentional.
-- =============================================================================

-- ---- 1. Extend TenantStatus enum ------------------------------------------
-- Postgres 12+ syntax; each ADD VALUE runs in its own statement to keep
-- the migration re-runnable (IF NOT EXISTS is safe on both).
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
ALTER TYPE "TenantStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- ---- 2. tenant_verifications ----------------------------------------------
-- One row per tenant, created at signup. Tracks the two applicant-side
-- verifications + the admin decision. When both *_verified_at columns are
-- set AND admin_decision is NULL, the tenant shows in the admin queue as
-- "Ready for review". Admin approve → tenants.status = 'ACTIVE'; reject
-- → tenants.status = 'REJECTED' + rejection_reason shown to applicant.
CREATE TABLE IF NOT EXISTS tenant_verifications (
  tenant_id                UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  -- Contact channels being verified. Cached from the owner membership /
  -- supplier profile at signup time so we can resend without a join, AND
  -- so a later contact-info edit doesn't invalidate the verification.
  contact_email            VARCHAR(255) NOT NULL,
  contact_phone            VARCHAR(40),

  -- Verification checkpoints
  email_verified_at        TIMESTAMPTZ,
  phone_verified_at        TIMESTAMPTZ,

  -- Admin review — set when the admin approves OR rejects. Once set, the
  -- applicant sees the decision on their next login.
  admin_reviewed_at        TIMESTAMPTZ,
  admin_reviewer_email     VARCHAR(255),
  admin_decision           VARCHAR(20),   -- 'approved' | 'rejected'
  admin_notes              TEXT,          -- internal, never shown to applicant
  rejection_reason         TEXT,          -- shown to applicant on rejected screen

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_verifications_ready_for_review_idx
  ON tenant_verifications (created_at)
  WHERE email_verified_at IS NOT NULL
    AND phone_verified_at IS NOT NULL
    AND admin_decision IS NULL;

CREATE INDEX IF NOT EXISTS tenant_verifications_awaiting_verification_idx
  ON tenant_verifications (created_at)
  WHERE (email_verified_at IS NULL OR phone_verified_at IS NULL)
    AND admin_decision IS NULL;

-- ---- 3. tenant_verification_tokens ----------------------------------------
-- One row per issued OTP code. Codes are stored in plaintext (they're
-- short-lived — 10 min — and single-use; hashing gains us nothing since
-- the entire row is invalidated on first use).
--
-- attempts_left counts DOWN from MAX_ATTEMPTS on each failed verify;
-- reaching 0 marks the code exhausted and the applicant must request a
-- resend. resend rate limit is enforced by counting rows in a 1-hour
-- window (see service layer).
CREATE TABLE IF NOT EXISTS tenant_verification_tokens (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Which channel this code is for. When we send a phone OTP we also
  -- record which transport ('whatsapp' / 'sms') carried it so support
  -- can see, e.g., "customer's WhatsApp bounced, we fell back to SMS".
  channel                  VARCHAR(20) NOT NULL,   -- 'email' | 'phone'
  transport                VARCHAR(20),            -- 'ses' | 'whatsapp' | 'sms'

  -- Where the code went. Cached so the applicant can request a fresh
  -- code without us re-reading their profile.
  destination              VARCHAR(255) NOT NULL,

  -- The 6-digit code (plaintext, single-use, short-lived).
  code                     VARCHAR(10) NOT NULL,

  -- Lifecycle
  expires_at               TIMESTAMPTZ NOT NULL,
  consumed_at              TIMESTAMPTZ,            -- set when successfully verified
  attempts_left            INT NOT NULL DEFAULT 5,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tenant_verification_tokens_tenant_channel_idx
  ON tenant_verification_tokens (tenant_id, channel, created_at DESC);

-- Convenience index for "find the latest live code for this tenant+channel"
-- (which is what verify + resend both need to look up).
CREATE INDEX IF NOT EXISTS tenant_verification_tokens_live_idx
  ON tenant_verification_tokens (tenant_id, channel)
  WHERE consumed_at IS NULL;

-- ---- 4. updated_at trigger for tenant_verifications -----------------------
-- Follows the same pattern used elsewhere in the schema.
CREATE OR REPLACE FUNCTION set_tenant_verifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenant_verifications_updated_at
  ON tenant_verifications;

CREATE TRIGGER trg_tenant_verifications_updated_at
  BEFORE UPDATE ON tenant_verifications
  FOR EACH ROW
  EXECUTE FUNCTION set_tenant_verifications_updated_at();
