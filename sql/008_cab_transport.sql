-- ============================================
-- 008: Cab/Transport System Tables
-- Adds ride-hailing infrastructure to tap-app
-- Business type: 'cab'
-- ============================================

-- 1. Add RIDE to OrderType enum
ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'RIDE';

-- 2. Add new member roles for drivers
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'DRIVER';
ALTER TYPE "MemberRole" ADD VALUE IF NOT EXISTS 'DISPATCHER';

-- ============================================
-- VEHICLES
-- ============================================

CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id),

  -- Vehicle details
  plate_number VARCHAR(20) NOT NULL,
  make VARCHAR(100),
  model VARCHAR(100),
  year INT,
  color VARCHAR(50),
  capacity INT DEFAULT 4,
  vehicle_type VARCHAR(30) DEFAULT 'sedan', -- sedan, suv, van, luxury, accessible

  -- Status
  status VARCHAR(20) DEFAULT 'active', -- active, inactive, maintenance, retired

  -- Insurance & compliance
  insurance_expiry DATE,
  inspection_expiry DATE,
  registration_expiry DATE,

  -- Metadata
  photo_url VARCHAR(500),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(tenant_id, plate_number)
);

CREATE INDEX idx_vehicles_tenant ON vehicles(tenant_id);
CREATE INDEX idx_vehicles_status ON vehicles(tenant_id, status);

-- ============================================
-- DRIVER PROFILES
-- Extends Membership with driver-specific data
-- ============================================

CREATE TABLE driver_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL UNIQUE REFERENCES memberships(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- License
  license_number VARCHAR(50),
  license_expiry DATE,
  license_class VARCHAR(10),

  -- Vehicle assignment
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL,

  -- Status
  duty_status VARCHAR(20) DEFAULT 'offline', -- online, offline, on_trip, break
  is_available BOOLEAN DEFAULT false,

  -- Stats
  rating DECIMAL(3, 2) DEFAULT 5.00,
  total_trips INT DEFAULT 0,
  total_earnings INT DEFAULT 0, -- cents
  acceptance_rate DECIMAL(5, 2) DEFAULT 100.00,
  cancellation_rate DECIMAL(5, 2) DEFAULT 0.00,

  -- Commission
  commission_type VARCHAR(20) DEFAULT 'percentage', -- percentage, flat, none
  commission_value DECIMAL(7, 2) DEFAULT 20.00,

  -- Documents
  photo_url VARCHAR(500),
  documents JSONB DEFAULT '[]',

  -- Preferences
  preferred_zones TEXT[] DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_driver_profiles_tenant ON driver_profiles(tenant_id);
CREATE INDEX idx_driver_profiles_membership ON driver_profiles(membership_id);
CREATE INDEX idx_driver_profiles_vehicle ON driver_profiles(vehicle_id);
CREATE INDEX idx_driver_profiles_duty ON driver_profiles(tenant_id, duty_status) WHERE is_available = true;

-- ============================================
-- DRIVER LOCATIONS (Real-time GPS tracking)
-- ============================================

CREATE TABLE driver_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  latitude DECIMAL(10, 7) NOT NULL,
  longitude DECIMAL(10, 7) NOT NULL,
  heading DECIMAL(5, 2), -- 0-360 degrees
  speed DECIMAL(7, 2), -- km/h
  accuracy DECIMAL(7, 2), -- meters

  recorded_at TIMESTAMPTZ DEFAULT now()
);

-- Only keep recent locations (last 24h), use partial index
CREATE INDEX idx_driver_locations_latest ON driver_locations(driver_profile_id, recorded_at DESC);
CREATE INDEX idx_driver_locations_geo ON driver_locations(tenant_id, latitude, longitude)
  WHERE recorded_at > now() - INTERVAL '1 hour';

-- ============================================
-- SERVICE ZONES (Areas of operation)
-- ============================================

CREATE TABLE zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name VARCHAR(100) NOT NULL,
  zone_type VARCHAR(30) DEFAULT 'service_area', -- service_area, airport, downtown, suburb, restricted
  description TEXT,

  -- Geofence (GeoJSON polygon stored as JSONB)
  boundary JSONB NOT NULL,

  -- Center point for proximity calculations
  center_lat DECIMAL(10, 7),
  center_lng DECIMAL(10, 7),
  radius_km DECIMAL(7, 2), -- if circular zone

  -- Surcharge
  surcharge_type VARCHAR(20) DEFAULT 'none', -- none, flat, percentage
  surcharge_amount INT DEFAULT 0, -- cents (for flat) or basis points (for percentage)
  surcharge_label VARCHAR(50), -- e.g. "Airport Fee"

  -- Operating hours (null = 24/7)
  operating_hours JSONB, -- { "mon": { "open": "06:00", "close": "23:00" }, ... }

  is_active BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_zones_tenant ON zones(tenant_id);

-- ============================================
-- FARE RULES (Pricing configuration)
-- ============================================

CREATE TABLE fare_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  name VARCHAR(100) NOT NULL,
  vehicle_type VARCHAR(30) DEFAULT 'sedan', -- matches vehicles.vehicle_type
  is_default BOOLEAN DEFAULT false,

  -- Base pricing (all amounts in cents)
  base_fare INT DEFAULT 350,           -- $3.50 flag drop
  minimum_fare INT DEFAULT 700,        -- $7.00 minimum
  per_km_rate INT DEFAULT 175,         -- $1.75 per km
  per_minute_rate INT DEFAULT 35,      -- $0.35 per minute
  booking_fee INT DEFAULT 200,         -- $2.00 booking fee

  -- Waiting charges
  waiting_rate_per_minute INT DEFAULT 35, -- $0.35 per minute waiting
  free_waiting_minutes INT DEFAULT 3,     -- first 3 minutes free

  -- Distance thresholds
  long_distance_km DECIMAL(7, 2) DEFAULT 50.00,
  long_distance_rate INT DEFAULT 150, -- reduced rate after threshold

  -- Time-based pricing
  peak_multiplier DECIMAL(4, 2) DEFAULT 1.00, -- surge pricing multiplier
  peak_hours JSONB, -- [{ "start": "07:00", "end": "09:00", "multiplier": 1.5 }, ...]
  night_multiplier DECIMAL(4, 2) DEFAULT 1.00,
  night_start VARCHAR(5) DEFAULT '22:00',
  night_end VARCHAR(5) DEFAULT '06:00',

  -- Weekend/holiday
  weekend_multiplier DECIMAL(4, 2) DEFAULT 1.00,
  holiday_multiplier DECIMAL(4, 2) DEFAULT 1.00,

  -- Cancellation
  cancellation_fee INT DEFAULT 500, -- $5.00
  free_cancel_minutes INT DEFAULT 2, -- free cancel within 2 min of booking

  -- Tax
  tax_included BOOLEAN DEFAULT false,

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_fare_rules_tenant ON fare_rules(tenant_id);
CREATE INDEX idx_fare_rules_default ON fare_rules(tenant_id, is_default) WHERE is_default = true;

-- ============================================
-- TRIPS (Core ride record)
-- ============================================

CREATE TYPE "TripStatus" AS ENUM (
  'REQUESTED',
  'SEARCHING',
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVERS'
);

CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id),

  -- Trip number (human-readable)
  trip_number VARCHAR(20) NOT NULL,
  display_number INT NOT NULL,

  -- Customer
  customer_name VARCHAR(255),
  customer_phone VARCHAR(20),
  customer_email VARCHAR(255),
  customer_membership_id UUID REFERENCES memberships(id),

  -- Driver
  driver_profile_id UUID REFERENCES driver_profiles(id),
  vehicle_id UUID REFERENCES vehicles(id),

  -- Pickup
  pickup_address TEXT NOT NULL,
  pickup_lat DECIMAL(10, 7) NOT NULL,
  pickup_lng DECIMAL(10, 7) NOT NULL,
  pickup_notes TEXT,

  -- Dropoff
  dropoff_address TEXT,
  dropoff_lat DECIMAL(10, 7),
  dropoff_lng DECIMAL(10, 7),
  dropoff_notes TEXT,

  -- Route
  estimated_distance_km DECIMAL(7, 2),
  actual_distance_km DECIMAL(7, 2),
  estimated_duration_minutes INT,
  actual_duration_minutes INT,
  route_polyline TEXT, -- encoded polyline for map display

  -- Fare (all in cents)
  estimated_fare INT DEFAULT 0,
  base_fare INT DEFAULT 0,
  distance_fare INT DEFAULT 0,
  time_fare INT DEFAULT 0,
  waiting_fare INT DEFAULT 0,
  surcharge INT DEFAULT 0,
  surcharge_label VARCHAR(50),
  discount_amount INT DEFAULT 0,
  subtotal INT DEFAULT 0,
  tax_amount INT DEFAULT 0,
  tip_amount INT DEFAULT 0,
  total INT DEFAULT 0,
  currency VARCHAR(3) DEFAULT 'CAD',

  -- Fare rule used
  fare_rule_id UUID REFERENCES fare_rules(id),
  peak_multiplier DECIMAL(4, 2) DEFAULT 1.00,

  -- Status
  status "TripStatus" DEFAULT 'REQUESTED',
  cancel_reason TEXT,
  cancelled_by VARCHAR(20), -- customer, driver, admin, system

  -- Payment
  payment_method VARCHAR(30), -- cash, card_online, card_in_cab, corporate
  payment_status "PaymentStatus" DEFAULT 'PENDING',
  order_id UUID REFERENCES orders(id), -- linked order for payment processing

  -- Scheduling
  is_scheduled BOOLEAN DEFAULT false,
  scheduled_at TIMESTAMPTZ,

  -- Ride type
  ride_type VARCHAR(30) DEFAULT 'standard', -- standard, premium, accessible, shared
  passenger_count INT DEFAULT 1,
  luggage BOOLEAN DEFAULT false,

  -- Promo
  promo_code VARCHAR(50),
  promo_discount INT DEFAULT 0,

  -- Timestamps
  requested_at TIMESTAMPTZ DEFAULT now(),
  assigned_at TIMESTAMPTZ,
  driver_arrived_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  -- Dispatch
  dispatch_attempts INT DEFAULT 0,
  dispatch_mode VARCHAR(20) DEFAULT 'auto', -- auto, manual

  -- Rating
  customer_rating INT, -- 1-5
  customer_feedback TEXT,
  driver_rating INT, -- 1-5
  driver_feedback TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_trips_tenant ON trips(tenant_id);
CREATE INDEX idx_trips_status ON trips(tenant_id, status);
CREATE INDEX idx_trips_driver ON trips(driver_profile_id);
CREATE INDEX idx_trips_customer ON trips(customer_phone);
CREATE INDEX idx_trips_date ON trips(tenant_id, requested_at);
CREATE INDEX idx_trips_number ON trips(tenant_id, trip_number);
CREATE INDEX idx_trips_scheduled ON trips(tenant_id, scheduled_at) WHERE is_scheduled = true;

-- ============================================
-- TRIP STATUS LOG (Audit trail)
-- ============================================

CREATE TABLE trip_status_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  changed_by VARCHAR(30), -- system, driver, customer, admin
  changed_by_id UUID,
  notes TEXT,

  latitude DECIMAL(10, 7),
  longitude DECIMAL(10, 7),

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_trip_status_log_trip ON trip_status_log(trip_id, created_at);

-- ============================================
-- DISPATCH QUEUE (Pending ride assignments)
-- ============================================

CREATE TABLE dispatch_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Target driver for this dispatch attempt
  driver_profile_id UUID REFERENCES driver_profiles(id),

  -- Dispatch details
  attempt_number INT DEFAULT 1,
  dispatch_radius_km DECIMAL(7, 2) DEFAULT 5.00,
  driver_distance_km DECIMAL(7, 2),
  estimated_eta_minutes INT,

  -- Status
  status VARCHAR(20) DEFAULT 'pending', -- pending, sent, accepted, rejected, expired, cancelled

  sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dispatch_queue_trip ON dispatch_queue(trip_id);
CREATE INDEX idx_dispatch_queue_driver ON dispatch_queue(driver_profile_id, status);
CREATE INDEX idx_dispatch_queue_pending ON dispatch_queue(tenant_id, status) WHERE status = 'pending';

-- ============================================
-- TRIP RATINGS
-- ============================================

CREATE TABLE trip_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

  rater_type VARCHAR(20) NOT NULL, -- customer, driver
  rater_id UUID,
  rated_id UUID,

  rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  feedback TEXT,
  tags TEXT[] DEFAULT '{}', -- clean_car, friendly, safe_driving, etc.

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_trip_ratings_trip ON trip_ratings(trip_id);

-- ============================================
-- PROMO CODES
-- ============================================

CREATE TABLE promo_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  code VARCHAR(30) NOT NULL,
  description TEXT,

  discount_type VARCHAR(20) DEFAULT 'percentage', -- percentage, flat, free_ride
  discount_value INT DEFAULT 0, -- percentage (1000 = 10%) or cents
  max_discount INT, -- max discount cap in cents

  -- Validity
  valid_from TIMESTAMPTZ DEFAULT now(),
  valid_until TIMESTAMPTZ,
  max_uses INT, -- total uses allowed
  max_uses_per_user INT DEFAULT 1,
  current_uses INT DEFAULT 0,
  min_fare INT DEFAULT 0, -- minimum fare to apply

  -- Targeting
  first_ride_only BOOLEAN DEFAULT false,
  ride_types TEXT[] DEFAULT '{}', -- empty = all types
  zones TEXT[] DEFAULT '{}', -- empty = all zones

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(tenant_id, code)
);

CREATE INDEX idx_promo_codes_tenant ON promo_codes(tenant_id);
CREATE INDEX idx_promo_codes_code ON promo_codes(tenant_id, code) WHERE is_active = true;

-- ============================================
-- CORPORATE ACCOUNTS (Phase 2 ready)
-- ============================================

CREATE TABLE corporate_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  company_name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(255),
  contact_email VARCHAR(255),
  contact_phone VARCHAR(20),
  billing_address TEXT,

  -- Billing
  billing_type VARCHAR(20) DEFAULT 'monthly', -- monthly, prepaid, per_trip
  credit_limit INT DEFAULT 0, -- cents
  current_balance INT DEFAULT 0, -- cents (negative = owed)
  payment_terms_days INT DEFAULT 30,

  -- Settings
  allow_cash BOOLEAN DEFAULT false,
  require_trip_code BOOLEAN DEFAULT false,
  max_fare_per_trip INT, -- cents, null = no limit

  status VARCHAR(20) DEFAULT 'active', -- active, suspended, closed

  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_corporate_accounts_tenant ON corporate_accounts(tenant_id);

CREATE TABLE corporate_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_account_id UUID NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  membership_id UUID REFERENCES memberships(id),

  employee_name VARCHAR(255),
  employee_email VARCHAR(255),
  employee_phone VARCHAR(20),
  employee_id VARCHAR(50), -- internal employee ID

  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_corporate_members_account ON corporate_members(corporate_account_id);

-- ============================================
-- CAB-SPECIFIC TENANT SETTINGS
-- ============================================

ALTER TABLE tenant_settings
  ADD COLUMN IF NOT EXISTS dispatch_mode VARCHAR(20) DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS dispatch_radius_km DECIMAL(7, 2) DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS dispatch_timeout_seconds INT DEFAULT 30,
  ADD COLUMN IF NOT EXISTS max_dispatch_attempts INT DEFAULT 5,
  ADD COLUMN IF NOT EXISTS driver_app_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_booking_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS scheduled_rides_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS surge_pricing_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS cash_rides_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS corporate_billing_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_vehicle_type VARCHAR(30) DEFAULT 'sedan',
  ADD COLUMN IF NOT EXISTS cancellation_policy JSONB DEFAULT '{"free_minutes": 2, "fee_cents": 500}',
  ADD COLUMN IF NOT EXISTS operating_hours JSONB,
  ADD COLUMN IF NOT EXISTS trip_number_prefix VARCHAR(10) DEFAULT 'TR',
  ADD COLUMN IF NOT EXISTS last_trip_number INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_trip_date DATE;

-- ============================================
-- SUPPORT TICKETS (for cab complaints)
-- ============================================

CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id UUID REFERENCES trips(id),

  reporter_type VARCHAR(20) NOT NULL, -- customer, driver
  reporter_name VARCHAR(255),
  reporter_phone VARCHAR(20),
  reporter_email VARCHAR(255),

  category VARCHAR(50), -- safety, billing, lost_item, driver_behavior, app_issue, other
  subject VARCHAR(255),
  description TEXT,

  status VARCHAR(20) DEFAULT 'open', -- open, in_progress, resolved, closed
  priority VARCHAR(20) DEFAULT 'normal', -- low, normal, high, urgent

  assigned_to UUID REFERENCES memberships(id),
  resolution TEXT,
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_support_tickets_tenant ON support_tickets(tenant_id);
CREATE INDEX idx_support_tickets_status ON support_tickets(tenant_id, status);
CREATE INDEX idx_support_tickets_trip ON support_tickets(trip_id);

-- ============================================
-- DRIVER EARNINGS (Daily summaries)
-- ============================================

CREATE TABLE driver_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_profile_id UUID NOT NULL REFERENCES driver_profiles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  earning_date DATE NOT NULL,

  total_trips INT DEFAULT 0,
  total_fares INT DEFAULT 0, -- cents
  total_tips INT DEFAULT 0, -- cents
  total_commission INT DEFAULT 0, -- cents (company takes)
  total_net INT DEFAULT 0, -- cents (driver keeps)

  online_hours DECIMAL(5, 2) DEFAULT 0, -- hours
  total_distance_km DECIMAL(7, 2) DEFAULT 0,

  cash_collected INT DEFAULT 0, -- cents
  card_collected INT DEFAULT 0, -- cents

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(driver_profile_id, earning_date)
);

CREATE INDEX idx_driver_earnings_driver ON driver_earnings(driver_profile_id, earning_date);
CREATE INDEX idx_driver_earnings_tenant ON driver_earnings(tenant_id, earning_date);
