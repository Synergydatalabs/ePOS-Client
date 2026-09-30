-- ============================================================
-- UNIFIED DEMO ACCOUNTS
-- One owner email across 4 business types
-- Login at: itap.zashx.com/partner/login
-- ============================================================
-- Owner (all 4):  demo@zashx.com / Demo2026!
-- POS Staff:      pos@demo.itap  / Demo2026!  (per tenant)
-- Drivers:        driver1@demo.itap / Demo2026! (cab only)
--                 driver2@demo.itap / Demo2026!
--                 driver3@demo.itap / Demo2026!
-- Technicians:    tech1@demo.itap / Demo2026!  (salon only)
--                 tech2@demo.itap / Demo2026!
-- ============================================================

-- Password hash for Demo2026!
-- $2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK

-- ************************************************************
-- TENANT 1: ARABICBEANS (Restaurant / Coffee Shop)
-- ************************************************************

INSERT INTO tenants (id, name, slug, status, currency, timezone, auth_provider, business_type, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-a001-000000000001',
  'ArabicBeans',
  'arabicbeans-demo',
  'ACTIVE', 'CAD', 'America/Toronto', 'local', 'restaurant',
  NOW(), NOW()
);

INSERT INTO subscriptions (id, tenant_id, plan, status, monthly_price, current_period_start, current_period_end, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-b001-000000000001',
  'd0000000-de10-4000-a001-000000000001',
  'demo', 'ACTIVE', 0, NOW(), '2099-12-31', NOW(), NOW()
);

INSERT INTO locations (id, tenant_id, name, address, city, province, postal_code, country, is_default, status, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-c001-000000000001',
  'd0000000-de10-4000-a001-000000000001',
  'ArabicBeans Downtown', '250 Yonge Street', 'Toronto', 'ON', 'M5B 2L7', 'CA',
  true, 'ACTIVE', NOW(), NOW()
);

INSERT INTO tenant_settings (id, tenant_id, tax_enabled, tax_rate, tax_label, tip_enabled, tip_presets, tip_custom_enabled,
  order_number_reset, kitchen_display_enabled, table_ordering_enabled,
  brand_name, brand_primary_color, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-d001-000000000001',
  'd0000000-de10-4000-a001-000000000001',
  true, 13.00, 'HST', true, '[15, 18, 20]'::jsonb, true,
  'DAILY', true, true,
  'ArabicBeans', '#D97706', NOW(), NOW()
);

-- Owner membership (restaurant)
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e001-000000000001',
  'd0000000-de10-4000-a001-000000000001',
  'local-demo@zashx.com', 'demo@zashx.com', 'Demo', 'Owner',
  'TENANT_OWNER', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);

-- POS Staff (restaurant)
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e001-000000000002',
  'd0000000-de10-4000-a001-000000000001',
  'local-pos@demo.itap', 'pos@demo.itap', 'Alex', 'Barista',
  'POS_STAFF', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);


-- ************************************************************
-- TENANT 2: VELVET GLOW STUDIO (Salon)
-- ************************************************************

INSERT INTO tenants (id, name, slug, status, currency, timezone, auth_provider, business_type, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-a002-000000000001',
  'Velvet Glow Studio',
  'velvet-glow-demo',
  'ACTIVE', 'CAD', 'America/Toronto', 'local', 'salon',
  NOW(), NOW()
);

INSERT INTO subscriptions (id, tenant_id, plan, status, monthly_price, current_period_start, current_period_end, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-b002-000000000001',
  'd0000000-de10-4000-a002-000000000001',
  'demo', 'ACTIVE', 0, NOW(), '2099-12-31', NOW(), NOW()
);

INSERT INTO locations (id, tenant_id, name, address, city, province, postal_code, country, is_default, status, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-c002-000000000001',
  'd0000000-de10-4000-a002-000000000001',
  'Velvet Glow - Queen West', '580 Queen Street West', 'Toronto', 'ON', 'M5V 2B5', 'CA',
  true, 'ACTIVE', NOW(), NOW()
);

INSERT INTO tenant_settings (id, tenant_id, tax_enabled, tax_rate, tax_label, tip_enabled, tip_presets, tip_custom_enabled,
  order_number_reset, kitchen_display_enabled, table_ordering_enabled,
  appointment_booking_enabled, buffer_time_minutes, booking_advance_days, walk_in_enabled,
  brand_name, brand_primary_color, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-d002-000000000001',
  'd0000000-de10-4000-a002-000000000001',
  true, 13.00, 'HST', true, '[15, 18, 20]'::jsonb, true,
  'DAILY', false, false,
  true, 15, 30, true,
  'Velvet Glow Studio', '#9333EA', NOW(), NOW()
);

-- Owner membership (salon)
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e002-000000000001',
  'd0000000-de10-4000-a002-000000000001',
  'local-demo@zashx.com', 'demo@zashx.com', 'Demo', 'Owner',
  'TENANT_OWNER', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);

-- Technician 1 (salon)
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e002-000000000010',
  'd0000000-de10-4000-a002-000000000001',
  'local-tech1@demo.itap', 'tech1@demo.itap', 'Mia', 'Laurent',
  'POS_STAFF', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);

-- Technician 2 (salon)
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e002-000000000011',
  'd0000000-de10-4000-a002-000000000001',
  'local-tech2@demo.itap', 'tech2@demo.itap', 'Sophia', 'Kim',
  'POS_STAFF', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);


-- ************************************************************
-- TENANT 3: CRUNCH CORNER (Retail / Snack Bar)
-- ************************************************************

INSERT INTO tenants (id, name, slug, status, currency, timezone, auth_provider, business_type, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-a003-000000000001',
  'Crunch Corner',
  'crunch-corner-demo',
  'ACTIVE', 'CAD', 'America/Toronto', 'local', 'retail',
  NOW(), NOW()
);

INSERT INTO subscriptions (id, tenant_id, plan, status, monthly_price, current_period_start, current_period_end, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-b003-000000000001',
  'd0000000-de10-4000-a003-000000000001',
  'demo', 'ACTIVE', 0, NOW(), '2099-12-31', NOW(), NOW()
);

INSERT INTO locations (id, tenant_id, name, address, city, province, postal_code, country, is_default, status, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-c003-000000000001',
  'd0000000-de10-4000-a003-000000000001',
  'Crunch Corner - Kensington', '45 Kensington Avenue', 'Toronto', 'ON', 'M5T 2K2', 'CA',
  true, 'ACTIVE', NOW(), NOW()
);

INSERT INTO tenant_settings (id, tenant_id, tax_enabled, tax_rate, tax_label, tip_enabled, tip_presets, tip_custom_enabled,
  order_number_reset, kitchen_display_enabled, table_ordering_enabled,
  brand_name, brand_primary_color, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-d003-000000000001',
  'd0000000-de10-4000-a003-000000000001',
  true, 13.00, 'HST', true, '[10, 15, 20]'::jsonb, true,
  'DAILY', false, false,
  'Crunch Corner', '#10B981', NOW(), NOW()
);

-- Owner membership (retail)
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e003-000000000001',
  'd0000000-de10-4000-a003-000000000001',
  'local-demo@zashx.com', 'demo@zashx.com', 'Demo', 'Owner',
  'TENANT_OWNER', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);

-- POS Staff (retail)
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e003-000000000002',
  'd0000000-de10-4000-a003-000000000001',
  'local-pos@demo.itap', 'pos@demo.itap', 'Jordan', 'Cashier',
  'POS_STAFF', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);


-- ************************************************************
-- TENANT 4: DASH RIDES TORONTO (Cab / Transport)
-- ************************************************************

INSERT INTO tenants (id, name, slug, status, currency, timezone, auth_provider, business_type, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-a004-000000000001',
  'Dash Rides Toronto',
  'dash-rides-demo',
  'ACTIVE', 'CAD', 'America/Toronto', 'local', 'cab',
  NOW(), NOW()
);

INSERT INTO subscriptions (id, tenant_id, plan, status, monthly_price, current_period_start, current_period_end, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-b004-000000000001',
  'd0000000-de10-4000-a004-000000000001',
  'demo', 'ACTIVE', 0, NOW(), '2099-12-31', NOW(), NOW()
);

INSERT INTO locations (id, tenant_id, name, address, city, province, postal_code, country, is_default, status, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-c004-000000000001',
  'd0000000-de10-4000-a004-000000000001',
  'Dash Rides HQ', '77 Bloor Street West', 'Toronto', 'ON', 'M5S 1M2', 'CA',
  true, 'ACTIVE', NOW(), NOW()
);

INSERT INTO tenant_settings (id, tenant_id, tax_rate, tax_label,
  dispatch_mode, dispatch_radius_km, max_dispatch_attempts, dispatch_timeout_seconds,
  driver_app_enabled, customer_booking_enabled, scheduled_rides_enabled,
  surge_pricing_enabled, cash_rides_enabled, corporate_billing_enabled,
  default_vehicle_type, trip_number_prefix,
  brand_name, brand_primary_color,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-d004-000000000001',
  'd0000000-de10-4000-a004-000000000001',
  13.00, 'HST',
  'auto', 10, 3, 30,
  true, true, true,
  true, true, true,
  'sedan', 'DSH',
  'Dash Rides Toronto', '#3B82F6',
  NOW(), NOW()
);

-- Owner membership (cab)
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e004-000000000001',
  'd0000000-de10-4000-a004-000000000001',
  'local-demo@zashx.com', 'demo@zashx.com', 'Demo', 'Owner',
  'TENANT_OWNER', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);

-- Dispatcher (cab)
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e004-000000000002',
  'd0000000-de10-4000-a004-000000000001',
  'local-dispatch@demo.itap', 'dispatch@demo.itap', 'Sarah', 'Dispatch',
  'DISPATCHER', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);

-- Driver 1
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e004-000000000010',
  'd0000000-de10-4000-a004-000000000001',
  'local-driver1@demo.itap', 'driver1@demo.itap', 'Ahmed', 'Hassan',
  'DRIVER', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);

-- Driver 2
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e004-000000000011',
  'd0000000-de10-4000-a004-000000000001',
  'local-driver2@demo.itap', 'driver2@demo.itap', 'Raj', 'Patel',
  'DRIVER', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);

-- Driver 3
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e004-000000000012',
  'd0000000-de10-4000-a004-000000000001',
  'local-driver3@demo.itap', 'driver3@demo.itap', 'Maria', 'Santos',
  'DRIVER', 'ACTIVE',
  '$2a$10$Vt1MswiM2qqPVVEag3oUaOn4FqTW3qmh0N5Q9LmknU6Q2XC8eI4lK',
  false, NOW(), NOW(), NOW(), NOW()
);

-- ── Vehicles ──
INSERT INTO vehicles (id, tenant_id, plate_number, make, model, year, color, vehicle_type, status, capacity, created_at, updated_at)
VALUES
  ('d0000000-de10-4000-f004-000000000001', 'd0000000-de10-4000-a004-000000000001', 'DASH 001', 'Toyota', 'Camry', 2024, 'White', 'sedan', 'active', 4, NOW(), NOW()),
  ('d0000000-de10-4000-f004-000000000002', 'd0000000-de10-4000-a004-000000000001', 'DASH 002', 'Honda', 'CR-V', 2024, 'Black', 'suv', 'active', 5, NOW(), NOW()),
  ('d0000000-de10-4000-f004-000000000003', 'd0000000-de10-4000-a004-000000000001', 'DASH 003', 'Dodge', 'Grand Caravan', 2023, 'Silver', 'van', 'active', 7, NOW(), NOW()),
  ('d0000000-de10-4000-f004-000000000004', 'd0000000-de10-4000-a004-000000000001', 'DASH 004', 'Mercedes', 'E-Class', 2025, 'Black', 'luxury', 'active', 4, NOW(), NOW());

-- ── Driver Profiles ──
INSERT INTO driver_profiles (id, tenant_id, membership_id, vehicle_id, duty_status,
  license_number, license_expiry, license_class, rating, total_trips, total_earnings,
  acceptance_rate, cancellation_rate, commission_type, commission_value,
  preferred_zones, created_at, updated_at)
VALUES
  ('d0000000-de10-4000-aa04-000000000001', 'd0000000-de10-4000-a004-000000000001', 'd0000000-de10-4000-e004-000000000010', 'd0000000-de10-4000-f004-000000000001', 'offline',
   'H1234-56789-01234', '2027-08-15', 'G', 4.85, 1247, 287500, 94.50, 2.10, 'percentage', 20.00, ARRAY['downtown','airport'], NOW(), NOW()),
  ('d0000000-de10-4000-aa04-000000000002', 'd0000000-de10-4000-a004-000000000001', 'd0000000-de10-4000-e004-000000000011', 'd0000000-de10-4000-f004-000000000002', 'offline',
   'P9876-54321-09876', '2027-11-30', 'G', 4.62, 832, 198400, 88.30, 4.50, 'percentage', 20.00, ARRAY['suburb','downtown'], NOW(), NOW()),
  ('d0000000-de10-4000-aa04-000000000003', 'd0000000-de10-4000-a004-000000000001', 'd0000000-de10-4000-e004-000000000012', 'd0000000-de10-4000-f004-000000000003', 'offline',
   'S5555-12345-67890', '2028-03-20', 'G', 4.91, 654, 163500, 96.20, 1.30, 'percentage', 18.00, ARRAY['airport','suburb'], NOW(), NOW());

-- ── Zones ──
INSERT INTO zones (id, tenant_id, name, zone_type, description, boundary, is_active, surcharge_type, surcharge_amount, created_at, updated_at)
VALUES
  ('d0000000-de10-4000-bb04-000000000001', 'd0000000-de10-4000-a004-000000000001', 'Downtown Core', 'downtown', 'Financial District, Entertainment District, Harbourfront',
   '{"type":"Polygon","coordinates":[[[-79.42,43.63],[-79.37,43.63],[-79.37,43.66],[-79.42,43.66],[-79.42,43.63]]]}'::jsonb,
   true, 'none', 0, NOW(), NOW()),
  ('d0000000-de10-4000-bb04-000000000002', 'd0000000-de10-4000-a004-000000000001', 'Pearson Airport (YYZ)', 'airport', 'Toronto Pearson International Airport - Terminals 1 & 3',
   '{"type":"Polygon","coordinates":[[[-79.65,43.67],[-79.60,43.67],[-79.60,43.69],[-79.65,43.69],[-79.65,43.67]]]}'::jsonb,
   true, 'flat', 500, NOW(), NOW()),
  ('d0000000-de10-4000-bb04-000000000003', 'd0000000-de10-4000-a004-000000000001', 'North York & Scarborough', 'suburb', 'North York, Scarborough, Don Mills',
   '{"type":"Polygon","coordinates":[[[-79.45,43.70],[-79.25,43.70],[-79.25,43.80],[-79.45,43.80],[-79.45,43.70]]]}'::jsonb,
   true, 'none', 0, NOW(), NOW()),
  ('d0000000-de10-4000-bb04-000000000004', 'd0000000-de10-4000-a004-000000000001', 'Mississauga', 'suburb', 'Square One, Port Credit, Streetsville',
   '{"type":"Polygon","coordinates":[[[-79.70,43.55],[-79.55,43.55],[-79.55,43.65],[-79.70,43.65],[-79.70,43.55]]]}'::jsonb,
   true, 'percentage', 500, NOW(), NOW());

-- ── Fare Rules ──
INSERT INTO fare_rules (id, tenant_id, name, vehicle_type, is_default, is_active,
  base_fare, per_km_rate, per_minute_rate, minimum_fare,
  waiting_rate_per_minute, free_waiting_minutes,
  peak_multiplier, night_multiplier, weekend_multiplier,
  cancellation_fee, free_cancel_minutes,
  peak_hours, created_at, updated_at)
VALUES
  ('d0000000-de10-4000-cc04-000000000001', 'd0000000-de10-4000-a004-000000000001', 'Standard Fare', 'sedan', true, true,
   350, 175, 35, 700, 50, 3, 1.50, 1.25, 1.10, 500, 3,
   '[{"start":"07:00","end":"09:30","multiplier":1.5},{"start":"16:30","end":"19:00","multiplier":1.5}]'::jsonb, NOW(), NOW()),
  ('d0000000-de10-4000-cc04-000000000002', 'd0000000-de10-4000-a004-000000000001', 'SUV / Premium', 'suv', false, true,
   500, 225, 45, 1000, 60, 3, 1.50, 1.25, 1.10, 700, 3,
   NULL, NOW(), NOW()),
  ('d0000000-de10-4000-cc04-000000000003', 'd0000000-de10-4000-a004-000000000001', 'Van / Accessible', 'van', false, true,
   450, 200, 40, 900, 50, 5, 1.30, 1.15, 1.00, 0, 5,
   NULL, NOW(), NOW()),
  ('d0000000-de10-4000-cc04-000000000004', 'd0000000-de10-4000-a004-000000000001', 'Luxury', 'luxury', false, true,
   800, 300, 60, 1500, 75, 5, 1.75, 1.35, 1.15, 1000, 5,
   NULL, NOW(), NOW());

-- ── Promo Codes ──
INSERT INTO promo_codes (id, tenant_id, code, description, discount_type, discount_value,
  max_discount, max_uses, max_uses_per_user, current_uses, is_active,
  valid_from, valid_until, created_at, updated_at)
VALUES
  ('d0000000-de10-4000-dd04-000000000001', 'd0000000-de10-4000-a004-000000000001', 'FIRSTRIDE', 'First ride - 50% off up to $15', 'percentage', 5000, 1500, 1000, 1, 12, true, NOW(), '2026-12-31', NOW(), NOW()),
  ('d0000000-de10-4000-dd04-000000000002', 'd0000000-de10-4000-a004-000000000001', 'SAVE5', '$5 off any ride', 'flat', 500, 500, 500, 3, 45, true, NOW(), '2026-12-31', NOW(), NOW()),
  ('d0000000-de10-4000-dd04-000000000003', 'd0000000-de10-4000-a004-000000000001', 'DASHVIP', '20% off premium rides', 'percentage', 2000, 2000, 100, 5, 3, true, NOW(), '2026-12-31', NOW(), NOW());

-- ── Sample Completed Trips ──
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone, driver_profile_id, vehicle_id,
  pickup_address, pickup_lat, pickup_lng, dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes, actual_distance_km, actual_duration_minutes,
  ride_type, passenger_count, luggage,
  base_fare, distance_fare, time_fare, surcharge, tax_amount, tip_amount, total,
  payment_method, payment_status, customer_rating, driver_rating,
  requested_at, assigned_at, driver_arrived_at, started_at, completed_at, created_at, updated_at)
VALUES
  -- Trip 1: Downtown to Airport
  ('d0000000-de10-4000-1104-000000000001', 'd0000000-de10-4000-a004-000000000001', 'DSH-00001', 1, 'COMPLETED',
   'Michael Brown', '+14165551001', 'd0000000-de10-4000-aa04-000000000001', 'd0000000-de10-4000-f004-000000000001',
   '100 King St W, Toronto', 43.6488, -79.3832, 'Pearson Airport Terminal 1', 43.6777, -79.6248,
   28.5, 35, 29.2, 38, 'standard', 1, true,
   350, 5110, 1330, 500, 947, 500, 8737,
   'card_online', 'COMPLETED', 5, 5,
   NOW()-INTERVAL '1 day 2 hours', NOW()-INTERVAL '1 day 1 hour 57 minutes', NOW()-INTERVAL '1 day 1 hour 50 minutes',
   NOW()-INTERVAL '1 day 1 hour 48 minutes', NOW()-INTERVAL '1 day 1 hour 10 minutes',
   NOW()-INTERVAL '1 day 2 hours', NOW()-INTERVAL '1 day 1 hour 10 minutes'),

  -- Trip 2: Short downtown ride
  ('d0000000-de10-4000-1104-000000000002', 'd0000000-de10-4000-a004-000000000001', 'DSH-00002', 2, 'COMPLETED',
   'Lisa Wang', '+14165551002', 'd0000000-de10-4000-aa04-000000000002', 'd0000000-de10-4000-f004-000000000002',
   'Union Station, Toronto', 43.6453, -79.3806, 'Eaton Centre, Toronto', 43.6544, -79.3807,
   2.1, 8, 2.4, 10, 'standard', 2, false,
   350, 420, 350, 0, 146, 200, 1466,
   'cash', 'COMPLETED', 4, NULL,
   NOW()-INTERVAL '3 hours', NOW()-INTERVAL '2 hours 58 minutes', NOW()-INTERVAL '2 hours 52 minutes',
   NOW()-INTERVAL '2 hours 50 minutes', NOW()-INTERVAL '2 hours 40 minutes',
   NOW()-INTERVAL '3 hours', NOW()-INTERVAL '2 hours 40 minutes'),

  -- Trip 3: SUV ride North York to downtown
  ('d0000000-de10-4000-1104-000000000003', 'd0000000-de10-4000-a004-000000000001', 'DSH-00003', 3, 'COMPLETED',
   'David Kim', '+14165551003', 'd0000000-de10-4000-aa04-000000000002', 'd0000000-de10-4000-f004-000000000002',
   'Yorkdale Mall, North York', 43.7254, -79.4522, 'CN Tower, Toronto', 43.6426, -79.3871,
   15.3, 22, 16.1, 25, 'premium', 3, true,
   500, 3623, 1125, 0, 682, 800, 6730,
   'card_online', 'COMPLETED', 5, 4,
   NOW()-INTERVAL '1 day 5 hours', NOW()-INTERVAL '1 day 4 hours 57 minutes', NOW()-INTERVAL '1 day 4 hours 50 minutes',
   NOW()-INTERVAL '1 day 4 hours 48 minutes', NOW()-INTERVAL '1 day 4 hours 23 minutes',
   NOW()-INTERVAL '1 day 5 hours', NOW()-INTERVAL '1 day 4 hours 23 minutes'),

  -- Trip 4: Accessible van ride
  ('d0000000-de10-4000-1104-000000000004', 'd0000000-de10-4000-a004-000000000001', 'DSH-00004', 4, 'COMPLETED',
   'Robert Johnson', '+14165551004', 'd0000000-de10-4000-aa04-000000000003', 'd0000000-de10-4000-f004-000000000003',
   'Sunnybrook Hospital, Toronto', 43.7224, -79.3697, '45 Elm St, Toronto', 43.6589, -79.3831,
   10.5, 18, 11.2, 20, 'accessible', 1, false,
   450, 2240, 800, 0, 454, 500, 4444,
   'card_in_cab', 'COMPLETED', 5, 5,
   NOW()-INTERVAL '5 hours', NOW()-INTERVAL '4 hours 58 minutes', NOW()-INTERVAL '4 hours 50 minutes',
   NOW()-INTERVAL '4 hours 48 minutes', NOW()-INTERVAL '4 hours 28 minutes',
   NOW()-INTERVAL '5 hours', NOW()-INTERVAL '4 hours 28 minutes');

-- ── Driver Earnings ──
INSERT INTO driver_earnings (id, driver_profile_id, tenant_id, earning_date,
  total_trips, total_fares, total_tips, total_commission, total_net,
  online_hours, total_distance_km, cash_collected, card_collected, created_at, updated_at)
VALUES
  ('d0000000-de10-4000-3304-000000000001', 'd0000000-de10-4000-aa04-000000000001', 'd0000000-de10-4000-a004-000000000001', CURRENT_DATE-1, 8, 42500, 6800, 8500, 40800, 9.5, 187.3, 12500, 30000, NOW(), NOW()),
  ('d0000000-de10-4000-3304-000000000002', 'd0000000-de10-4000-aa04-000000000001', 'd0000000-de10-4000-a004-000000000001', CURRENT_DATE, 3, 15200, 2500, 3040, 14660, 4.5, 62.1, 0, 15200, NOW(), NOW()),
  ('d0000000-de10-4000-3304-000000000003', 'd0000000-de10-4000-aa04-000000000002', 'd0000000-de10-4000-a004-000000000001', CURRENT_DATE-1, 6, 31800, 4200, 6360, 29640, 8.0, 142.6, 8500, 23300, NOW(), NOW()),
  ('d0000000-de10-4000-3304-000000000004', 'd0000000-de10-4000-aa04-000000000002', 'd0000000-de10-4000-a004-000000000001', CURRENT_DATE, 2, 8200, 1200, 1640, 7760, 3.0, 35.8, 1466, 6734, NOW(), NOW()),
  ('d0000000-de10-4000-3304-000000000005', 'd0000000-de10-4000-aa04-000000000003', 'd0000000-de10-4000-a004-000000000001', CURRENT_DATE, 4, 22300, 3800, 4014, 22086, 6.5, 95.4, 4444, 17856, NOW(), NOW());


-- ============================================================
-- SUMMARY — DEMO LOGIN CREDENTIALS
-- ============================================================
--
-- OWNER (itap.zashx.com/partner/login):
--   Email:    demo@zashx.com
--   Password: Demo2026!
--   -> Tenant picker shows: ArabicBeans, Velvet Glow, Crunch Corner, Dash Rides
--
-- POS STAFF (itap.zashx.com/pos/login):
--   Email:    pos@demo.itap / Demo2026!
--   -> Works for ArabicBeans (restaurant) and Crunch Corner (retail)
--
-- SALON TECHNICIANS:
--   tech1@demo.itap / Demo2026!  (Mia Laurent)
--   tech2@demo.itap / Demo2026!  (Sophia Kim)
--
-- CAB DRIVERS (itap.zashx.com/drive/driver/login):
--   driver1@demo.itap / Demo2026!  (Ahmed Hassan - Toyota Camry)
--   driver2@demo.itap / Demo2026!  (Raj Patel - Honda CR-V)
--   driver3@demo.itap / Demo2026!  (Maria Santos - Dodge Caravan)
--
-- CAB DISPATCHER:
--   dispatch@demo.itap / Demo2026!
--
-- BUSINESSES:
--   ArabicBeans          (restaurant) - amber theme
--   Velvet Glow Studio   (salon)      - purple theme
--   Crunch Corner        (retail)     - green theme
--   Dash Rides Toronto   (cab)        - blue theme
-- ============================================================
