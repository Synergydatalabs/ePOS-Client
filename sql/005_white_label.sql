-- ============================================
-- 005: White-Label Multi-Tenant Support
-- ============================================
-- Adds branding, custom domain, DB-based auth for partner tenants
-- Run this on the itap_pos_dev database

-- 1. Auth provider on tenants (cognito = existing zashx, local = partner DB auth)
ALTER TABLE tenants ADD COLUMN auth_provider VARCHAR(20) NOT NULL DEFAULT 'cognito';

-- 2. Branding fields on tenant_settings
ALTER TABLE tenant_settings
  ADD COLUMN brand_name VARCHAR(255),
  ADD COLUMN brand_logo_url VARCHAR(500),
  ADD COLUMN brand_favicon_url VARCHAR(500),
  ADD COLUMN brand_primary_color VARCHAR(7) DEFAULT '#4F46E5',
  ADD COLUMN brand_accent_color VARCHAR(7) DEFAULT '#6366F1',
  ADD COLUMN brand_background_color VARCHAR(7) DEFAULT '#F9FAFB',
  ADD COLUMN powered_by_visible BOOLEAN DEFAULT true,
  ADD COLUMN custom_domain VARCHAR(255);

-- 3. Password reset fields on memberships
ALTER TABLE memberships
  ADD COLUMN password_reset_token VARCHAR(255),
  ADD COLUMN password_reset_expires TIMESTAMPTZ;

-- 4. Indexes
CREATE UNIQUE INDEX idx_tenant_settings_custom_domain ON tenant_settings(custom_domain) WHERE custom_domain IS NOT NULL;
CREATE INDEX idx_memberships_reset_token ON memberships(password_reset_token) WHERE password_reset_token IS NOT NULL;
