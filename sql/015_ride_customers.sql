-- ============================================================
-- 015: Ride Customers — Customer accounts for cab booking
-- Demo:  rider@demo.itap / Demo2026!
-- ============================================================

CREATE TABLE IF NOT EXISTS ride_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Profile
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  password_hash VARCHAR(255) NOT NULL,
  photo_url VARCHAR(500),

  -- Preferences
  default_payment_method VARCHAR(30) DEFAULT 'cash',
  saved_addresses JSONB DEFAULT '[]',

  -- Stats
  total_trips INT DEFAULT 0,
  rating DECIMAL(3,2) DEFAULT 5.00,

  -- Status
  is_active BOOLEAN DEFAULT true,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_ride_customers_tenant ON ride_customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ride_customers_email ON ride_customers(tenant_id, email);

-- ── Demo customer for Dash Rides Toronto ──
-- Password: Demo2026!  (same bcrypt hash as other demo accounts)
INSERT INTO ride_customers (id, tenant_id, name, email, phone, password_hash, default_payment_method, total_trips, rating)
VALUES (
  'd0000000-de10-4000-c004-000000000001',
  'd0000000-de10-4000-a004-000000000001',
  'James Wilson',
  'rider@demo.itap',
  '416-555-0199',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  'cash',
  12,
  4.90
) ON CONFLICT (tenant_id, email) DO NOTHING;

-- Second demo customer
INSERT INTO ride_customers (id, tenant_id, name, email, phone, password_hash, default_payment_method, total_trips, rating)
VALUES (
  'd0000000-de10-4000-c004-000000000002',
  'd0000000-de10-4000-a004-000000000001',
  'Emily Chen',
  'rider2@demo.itap',
  '647-555-0234',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  'card',
  5,
  5.00
) ON CONFLICT (tenant_id, email) DO NOTHING;
