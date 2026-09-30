-- ============================================================
-- CAB DEMO SEED DATA
-- Company: "City Cab Toronto"
-- Owner:   cab@itap.zashx.com / Cab2026!
-- Drivers: driver1@citycab.demo / Driver1!
--          driver2@citycab.demo / Driver1!
--          driver3@citycab.demo / Driver1!
-- ============================================================

-- ── 1. Tenant ────────────────────────────────────────────────
INSERT INTO tenants (id, name, slug, status, currency, timezone, auth_provider, business_type, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-a000-000000000001',
  'City Cab Toronto',
  'city-cab-demo',
  'ACTIVE',
  'CAD',
  'America/Toronto',
  'local',
  'cab',
  NOW(), NOW()
);

-- ── 2. Subscription (permanent ACTIVE) ──────────────────────
INSERT INTO subscriptions (id, tenant_id, plan, status, monthly_price, trial_ends_at, current_period_start, current_period_end, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-b000-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'demo',
  'ACTIVE',
  0,
  NULL,
  NOW(),
  '2099-12-31',
  NOW(), NOW()
);

-- ── 3. Location ──────────────────────────────────────────────
INSERT INTO locations (id, tenant_id, name, address, city, province, postal_code, country, phone, is_primary, status, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-c000-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'Head Office',
  '100 King Street West',
  'Toronto',
  'ON',
  'M5X 1A9',
  'CA',
  '+14165551234',
  true,
  'ACTIVE',
  NOW(), NOW()
);

-- ── 4. Tenant Settings (cab-specific) ────────────────────────
INSERT INTO tenant_settings (id, tenant_id, tax_rate, tax_label, currency, timezone,
  dispatch_mode, dispatch_radius_km, max_dispatch_attempts, dispatch_timeout_seconds,
  auto_assign_nearest, allow_driver_reject, driver_commission_default, driver_commission_type,
  peak_pricing_enabled, surge_multiplier_cap,
  require_photo_on_pickup, require_photo_on_dropoff,
  max_scheduled_advance_hours, free_waiting_minutes,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-d000-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  13.00,        -- HST Ontario
  'HST',
  'CAD',
  'America/Toronto',
  'auto',       -- auto dispatch
  10,           -- 10km radius
  3,            -- max 3 attempts
  30,           -- 30s timeout per driver
  true,         -- assign nearest
  true,         -- allow driver to reject
  20.00,        -- 20% commission
  'percentage',
  true,         -- peak pricing on
  2.50,         -- max 2.5x surge
  false, false, -- no photos required
  168,          -- 7 days advance booking
  3,            -- 3 min free waiting
  NOW(), NOW()
);

-- ── 5. Owner Membership ──────────────────────────────────────
-- Password: Cab2026!
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-e000-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'local-cab@itap.zashx.com',
  'cab@itap.zashx.com',
  'Admin',
  'CabDemo',
  'TENANT_OWNER',
  'ACTIVE',
  '$2a$10$lpR0VE2Vhs16U7X/U8b2luy.yxYC1q.vt4D//gkBcEkKvM9y9s02u',
  false,
  NOW(), NOW(), NOW(), NOW()
);

-- ── 6. Dispatcher Membership ─────────────────────────────────
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-e000-000000000002',
  'b0000000-cab0-4000-a000-000000000001',
  'local-dispatch@citycab.demo',
  'dispatch@citycab.demo',
  'Sarah',
  'Dispatch',
  'DISPATCHER',
  'ACTIVE',
  '$2a$10$lpR0VE2Vhs16U7X/U8b2luy.yxYC1q.vt4D//gkBcEkKvM9y9s02u',
  false,
  NOW(), NOW(), NOW(), NOW()
);

-- ── 7. Driver Memberships ────────────────────────────────────
-- Password for all drivers: Driver1!

-- Driver 1: Ahmed
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-e000-000000000010',
  'b0000000-cab0-4000-a000-000000000001',
  'local-driver1@citycab.demo',
  'driver1@citycab.demo',
  'Ahmed',
  'Hassan',
  'DRIVER',
  'ACTIVE',
  '$2a$10$TgHZ.vweHpMG2.HdcTNMeO/oYFtrtvgmFDPfw1kURAgE65exHMJeC',
  false,
  NOW(), NOW(), NOW(), NOW()
);

-- Driver 2: Raj
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-e000-000000000011',
  'b0000000-cab0-4000-a000-000000000001',
  'local-driver2@citycab.demo',
  'driver2@citycab.demo',
  'Raj',
  'Patel',
  'DRIVER',
  'ACTIVE',
  '$2a$10$TgHZ.vweHpMG2.HdcTNMeO/oYFtrtvgmFDPfw1kURAgE65exHMJeC',
  false,
  NOW(), NOW(), NOW(), NOW()
);

-- Driver 3: Maria
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-e000-000000000012',
  'b0000000-cab0-4000-a000-000000000001',
  'local-driver3@citycab.demo',
  'driver3@citycab.demo',
  'Maria',
  'Santos',
  'DRIVER',
  'ACTIVE',
  '$2a$10$TgHZ.vweHpMG2.HdcTNMeO/oYFtrtvgmFDPfw1kURAgE65exHMJeC',
  false,
  NOW(), NOW(), NOW(), NOW()
);

-- ── 8. Vehicles ──────────────────────────────────────────────

-- Vehicle 1: Toyota Camry (Ahmed)
INSERT INTO vehicles (id, tenant_id, plate_number, make, model, year, color, vehicle_type, status, capacity, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-f000-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'DEMO 001',
  'Toyota',
  'Camry',
  2024,
  'White',
  'sedan',
  'active',
  4,
  NOW(), NOW()
);

-- Vehicle 2: Honda CR-V (Raj)
INSERT INTO vehicles (id, tenant_id, plate_number, make, model, year, color, vehicle_type, status, capacity, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-f000-000000000002',
  'b0000000-cab0-4000-a000-000000000001',
  'DEMO 002',
  'Honda',
  'CR-V',
  2024,
  'Black',
  'suv',
  5,
  NOW(), NOW()
);

-- Vehicle 3: Dodge Grand Caravan (Maria)
INSERT INTO vehicles (id, tenant_id, plate_number, make, model, year, color, vehicle_type, status, capacity, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-f000-000000000003',
  'b0000000-cab0-4000-a000-000000000001',
  'DEMO 003',
  'Dodge',
  'Grand Caravan',
  2023,
  'Silver',
  'van',
  7,
  NOW(), NOW()
);

-- Vehicle 4: Mercedes E-Class (spare luxury)
INSERT INTO vehicles (id, tenant_id, plate_number, make, model, year, color, vehicle_type, status, capacity, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-f000-000000000004',
  'b0000000-cab0-4000-a000-000000000001',
  'DEMO 004',
  'Mercedes',
  'E-Class',
  2025,
  'Black',
  'luxury',
  4,
  NOW(), NOW()
);

-- ── 9. Driver Profiles ───────────────────────────────────────

-- Ahmed - experienced, high rating
INSERT INTO driver_profiles (id, tenant_id, membership_id, vehicle_id, duty_status,
  license_number, license_expiry, license_class, rating, total_trips, total_earnings,
  acceptance_rate, cancellation_rate, commission_type, commission_value,
  preferred_zones, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-aa00-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'b0000000-cab0-4000-e000-000000000010',
  'b0000000-cab0-4000-f000-000000000001',
  'offline',
  'H1234-56789-01234',
  '2027-08-15',
  'G',
  4.85,
  1247,
  287500,  -- $2,875.00
  94.50,
  2.10,
  'percentage',
  20.00,
  ARRAY['downtown', 'airport'],
  NOW(), NOW()
);

-- Raj - mid-level, SUV driver
INSERT INTO driver_profiles (id, tenant_id, membership_id, vehicle_id, duty_status,
  license_number, license_expiry, license_class, rating, total_trips, total_earnings,
  acceptance_rate, cancellation_rate, commission_type, commission_value,
  preferred_zones, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-aa00-000000000002',
  'b0000000-cab0-4000-a000-000000000001',
  'b0000000-cab0-4000-e000-000000000011',
  'b0000000-cab0-4000-f000-000000000002',
  'offline',
  'P9876-54321-09876',
  '2027-11-30',
  'G',
  4.62,
  832,
  198400,  -- $1,984.00
  88.30,
  4.50,
  'percentage',
  20.00,
  ARRAY['suburb', 'downtown'],
  NOW(), NOW()
);

-- Maria - van driver, accessible
INSERT INTO driver_profiles (id, tenant_id, membership_id, vehicle_id, duty_status,
  license_number, license_expiry, license_class, rating, total_trips, total_earnings,
  acceptance_rate, cancellation_rate, commission_type, commission_value,
  preferred_zones, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-aa00-000000000003',
  'b0000000-cab0-4000-a000-000000000001',
  'b0000000-cab0-4000-e000-000000000012',
  'b0000000-cab0-4000-f000-000000000003',
  'offline',
  'S5555-12345-67890',
  '2028-03-20',
  'G',
  4.91,
  654,
  163500,  -- $1,635.00
  96.20,
  1.30,
  'percentage',
  18.00,  -- lower commission, van costs more
  ARRAY['airport', 'suburb'],
  NOW(), NOW()
);

-- ── 10. Zones ─────────────────────────────────────────────────

-- Downtown Toronto
INSERT INTO zones (id, tenant_id, name, zone_type, description, is_active,
  surcharge_type, surcharge_amount, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-bb00-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'Downtown Core',
  'downtown',
  'Financial District, Entertainment District, Harbourfront',
  true,
  'none',
  0,
  NOW(), NOW()
);

-- Pearson Airport
INSERT INTO zones (id, tenant_id, name, zone_type, description, is_active,
  surcharge_type, surcharge_amount, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-bb00-000000000002',
  'b0000000-cab0-4000-a000-000000000001',
  'Pearson Airport (YYZ)',
  'airport',
  'Toronto Pearson International Airport - Terminals 1 & 3',
  true,
  'flat',
  500,   -- $5.00 airport surcharge
  NOW(), NOW()
);

-- North York / Scarborough
INSERT INTO zones (id, tenant_id, name, zone_type, description, is_active,
  surcharge_type, surcharge_amount, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-bb00-000000000003',
  'b0000000-cab0-4000-a000-000000000001',
  'North York & Scarborough',
  'suburb',
  'North York, Scarborough, Don Mills',
  true,
  'none',
  0,
  NOW(), NOW()
);

-- Mississauga
INSERT INTO zones (id, tenant_id, name, zone_type, description, is_active,
  surcharge_type, surcharge_amount, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-bb00-000000000004',
  'b0000000-cab0-4000-a000-000000000001',
  'Mississauga',
  'suburb',
  'Square One, Port Credit, Streetsville',
  true,
  'percentage',
  500,   -- 5% surcharge (basis points for percentage)
  NOW(), NOW()
);

-- ── 11. Fare Rules ────────────────────────────────────────────

-- Standard fare (sedan)
INSERT INTO fare_rules (id, tenant_id, name, vehicle_type, is_default, is_active,
  base_fare, per_km_rate, per_minute_rate, minimum_fare,
  waiting_rate_per_minute, free_waiting_minutes,
  long_distance_km, long_distance_rate,
  peak_multiplier, night_multiplier, weekend_multiplier,
  cancellation_fee, free_cancel_minutes,
  peak_hours,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-cc00-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'Standard Fare',
  'sedan',
  true,
  true,
  350,     -- $3.50 base
  175,     -- $1.75/km
  35,      -- $0.35/min
  700,     -- $7.00 minimum
  50,      -- $0.50/min waiting
  3,       -- 3 min free
  30,      -- long distance > 30km
  150,     -- $1.50/km long distance rate
  1.50,    -- 1.5x peak
  1.25,    -- 1.25x night (11pm-6am)
  1.10,    -- 1.1x weekend
  500,     -- $5.00 cancellation
  3,       -- free cancel within 3 min
  '[{"start":"07:00","end":"09:30","multiplier":1.5},{"start":"16:30","end":"19:00","multiplier":1.5}]'::jsonb,
  NOW(), NOW()
);

-- SUV fare (premium)
INSERT INTO fare_rules (id, tenant_id, name, vehicle_type, is_default, is_active,
  base_fare, per_km_rate, per_minute_rate, minimum_fare,
  waiting_rate_per_minute, free_waiting_minutes,
  peak_multiplier, night_multiplier, weekend_multiplier,
  cancellation_fee, free_cancel_minutes,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-cc00-000000000002',
  'b0000000-cab0-4000-a000-000000000001',
  'SUV / Premium Fare',
  'suv',
  false,
  true,
  500,     -- $5.00 base
  225,     -- $2.25/km
  45,      -- $0.45/min
  1000,    -- $10.00 minimum
  60,      -- $0.60/min waiting
  3,
  1.50,
  1.25,
  1.10,
  700,     -- $7.00 cancellation
  3,
  NOW(), NOW()
);

-- Van / Accessible fare
INSERT INTO fare_rules (id, tenant_id, name, vehicle_type, is_default, is_active,
  base_fare, per_km_rate, per_minute_rate, minimum_fare,
  waiting_rate_per_minute, free_waiting_minutes,
  peak_multiplier, night_multiplier, weekend_multiplier,
  cancellation_fee, free_cancel_minutes,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-cc00-000000000003',
  'b0000000-cab0-4000-a000-000000000001',
  'Van / Accessible Fare',
  'van',
  false,
  true,
  450,     -- $4.50 base
  200,     -- $2.00/km
  40,      -- $0.40/min
  900,     -- $9.00 minimum
  50,
  5,       -- 5 min free for accessible
  1.30,    -- lower peak surge for accessible
  1.15,
  1.00,    -- no weekend surcharge for accessible
  0,       -- no cancellation fee for accessible
  5,
  NOW(), NOW()
);

-- Luxury fare
INSERT INTO fare_rules (id, tenant_id, name, vehicle_type, is_default, is_active,
  base_fare, per_km_rate, per_minute_rate, minimum_fare,
  waiting_rate_per_minute, free_waiting_minutes,
  peak_multiplier, night_multiplier, weekend_multiplier,
  cancellation_fee, free_cancel_minutes,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-cc00-000000000004',
  'b0000000-cab0-4000-a000-000000000001',
  'Luxury Fare',
  'luxury',
  false,
  true,
  800,     -- $8.00 base
  300,     -- $3.00/km
  60,      -- $0.60/min
  1500,    -- $15.00 minimum
  75,      -- $0.75/min waiting
  5,
  1.75,    -- higher peak
  1.35,
  1.15,
  1000,    -- $10.00 cancellation
  5,
  NOW(), NOW()
);

-- ── 12. Promo Codes ───────────────────────────────────────────

-- First ride discount
INSERT INTO promo_codes (id, tenant_id, code, description, discount_type, discount_value,
  max_discount, max_uses, max_uses_per_user, current_uses, is_active,
  valid_from, valid_until, ride_types, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-dd00-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'FIRSTRIDE',
  'First ride - 50% off up to $15',
  'percentage',
  5000,    -- 50% (basis points)
  1500,    -- max $15.00
  1000,
  1,
  12,
  true,
  NOW(),
  '2026-12-31',
  ARRAY['standard', 'premium'],
  NOW(), NOW()
);

-- Flat $5 off
INSERT INTO promo_codes (id, tenant_id, code, description, discount_type, discount_value,
  max_discount, max_uses, max_uses_per_user, current_uses, is_active,
  valid_from, valid_until, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-dd00-000000000002',
  'b0000000-cab0-4000-a000-000000000001',
  'SAVE5',
  '$5 off any ride',
  'flat',
  500,     -- $5.00
  500,     -- max discount = value for flat
  500,
  3,
  45,
  true,
  NOW(),
  '2026-12-31',
  NOW(), NOW()
);

-- Airport promo
INSERT INTO promo_codes (id, tenant_id, code, description, discount_type, discount_value,
  max_discount, max_uses, max_uses_per_user, current_uses, is_active,
  valid_from, valid_until, zones, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-dd00-000000000003',
  'b0000000-cab0-4000-a000-000000000001',
  'AIRPORT10',
  '10% off airport rides',
  'percentage',
  1000,    -- 10%
  1000,    -- max $10.00
  200,
  5,
  8,
  true,
  NOW(),
  '2026-12-31',
  ARRAY['airport'],
  NOW(), NOW()
);

-- ── 13. Corporate Account ─────────────────────────────────────

INSERT INTO corporate_accounts (id, tenant_id, company_name, contact_name, contact_email,
  contact_phone, billing_type, credit_limit, balance_used, payment_terms_days,
  is_active, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-ee00-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'Synergy Data Labs',
  'James Chen',
  'transport@synergydatalabs.com',
  '+14165559876',
  'monthly',
  500000,  -- $5,000.00 credit limit
  0,
  30,
  true,
  NOW(), NOW()
);

-- ── 14. Sample Completed Trips ────────────────────────────────
-- A few completed trips to show in history

-- Trip 1: Downtown to Airport (Ahmed, completed yesterday)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone,
  driver_profile_id, vehicle_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  actual_distance_km, actual_duration_minutes,
  ride_type, passenger_count, luggage,
  base_fare, distance_fare, time_fare, surcharge, tax, tip, total_fare,
  payment_method, payment_status,
  customer_rating, driver_rating,
  requested_at, assigned_at, driver_arrived_at, started_at, completed_at,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-1100-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'CCT-00001',
  1,
  'COMPLETED',
  'Michael Brown',
  '+14165551001',
  'b0000000-cab0-4000-aa00-000000000001',
  'b0000000-cab0-4000-f000-000000000001',
  '100 King St W, Toronto',
  43.6488,
  -79.3832,
  'Pearson Airport Terminal 1',
  43.6777,
  -79.6248,
  28.5,
  35,
  29.2,
  38,
  'standard',
  1,
  true,
  350, 5110, 1330, 500, 947, 500, 8737,
  'card_online',
  'COMPLETED',
  5, 5,
  NOW() - INTERVAL '1 day 2 hours',
  NOW() - INTERVAL '1 day 1 hour 57 minutes',
  NOW() - INTERVAL '1 day 1 hour 50 minutes',
  NOW() - INTERVAL '1 day 1 hour 48 minutes',
  NOW() - INTERVAL '1 day 1 hour 10 minutes',
  NOW() - INTERVAL '1 day 2 hours',
  NOW() - INTERVAL '1 day 1 hour 10 minutes'
);

-- Trip 2: Short downtown ride (Raj, completed today)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone, customer_email,
  driver_profile_id, vehicle_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  actual_distance_km, actual_duration_minutes,
  ride_type, passenger_count,
  base_fare, distance_fare, time_fare, tax, tip, total_fare,
  payment_method, payment_status,
  customer_rating,
  requested_at, assigned_at, driver_arrived_at, started_at, completed_at,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-1100-000000000002',
  'b0000000-cab0-4000-a000-000000000001',
  'CCT-00002',
  2,
  'COMPLETED',
  'Lisa Wang',
  '+14165551002',
  'lisa.wang@email.com',
  'b0000000-cab0-4000-aa00-000000000002',
  'b0000000-cab0-4000-f000-000000000002',
  'Union Station, Toronto',
  43.6453,
  -79.3806,
  'Eaton Centre, Toronto',
  43.6544,
  -79.3807,
  2.1,
  8,
  2.4,
  10,
  'standard',
  2,
  350, 420, 350, 146, 200, 1466,
  'cash',
  'COMPLETED',
  4,
  NOW() - INTERVAL '3 hours',
  NOW() - INTERVAL '2 hours 58 minutes',
  NOW() - INTERVAL '2 hours 52 minutes',
  NOW() - INTERVAL '2 hours 50 minutes',
  NOW() - INTERVAL '2 hours 40 minutes',
  NOW() - INTERVAL '3 hours',
  NOW() - INTERVAL '2 hours 40 minutes'
);

-- Trip 3: SUV ride, North York to downtown (Raj, completed yesterday)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone,
  driver_profile_id, vehicle_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  actual_distance_km, actual_duration_minutes,
  ride_type, passenger_count, luggage,
  base_fare, distance_fare, time_fare, tax, tip, total_fare,
  payment_method, payment_status,
  customer_rating, driver_rating,
  requested_at, assigned_at, driver_arrived_at, started_at, completed_at,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-1100-000000000003',
  'b0000000-cab0-4000-a000-000000000001',
  'CCT-00003',
  3,
  'COMPLETED',
  'David Kim',
  '+14165551003',
  'b0000000-cab0-4000-aa00-000000000002',
  'b0000000-cab0-4000-f000-000000000002',
  'Yorkdale Mall, North York',
  43.7254,
  -79.4522,
  'CN Tower, Toronto',
  43.6426,
  -79.3871,
  15.3,
  22,
  16.1,
  25,
  'premium',
  3,
  true,
  500, 3623, 1125, 682, 800, 6730,
  'card_online',
  'COMPLETED',
  5, 4,
  NOW() - INTERVAL '1 day 5 hours',
  NOW() - INTERVAL '1 day 4 hours 57 minutes',
  NOW() - INTERVAL '1 day 4 hours 50 minutes',
  NOW() - INTERVAL '1 day 4 hours 48 minutes',
  NOW() - INTERVAL '1 day 4 hours 23 minutes',
  NOW() - INTERVAL '1 day 5 hours',
  NOW() - INTERVAL '1 day 4 hours 23 minutes'
);

-- Trip 4: Accessible van ride (Maria, completed today)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone,
  driver_profile_id, vehicle_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  actual_distance_km, actual_duration_minutes,
  ride_type, passenger_count,
  base_fare, distance_fare, time_fare, tax, tip, total_fare,
  payment_method, payment_status,
  customer_rating, driver_rating,
  requested_at, assigned_at, driver_arrived_at, started_at, completed_at,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-1100-000000000004',
  'b0000000-cab0-4000-a000-000000000001',
  'CCT-00004',
  4,
  'COMPLETED',
  'Robert Johnson',
  '+14165551004',
  'b0000000-cab0-4000-aa00-000000000003',
  'b0000000-cab0-4000-f000-000000000003',
  'Sunnybrook Hospital, Toronto',
  43.7224,
  -79.3697,
  '45 Elm St, Toronto',
  43.6589,
  -79.3831,
  10.5,
  18,
  11.2,
  20,
  'accessible',
  1,
  450, 2240, 800, 454, 500, 4444,
  'card_in_cab',
  'COMPLETED',
  5, 5,
  NOW() - INTERVAL '5 hours',
  NOW() - INTERVAL '4 hours 58 minutes',
  NOW() - INTERVAL '4 hours 50 minutes',
  NOW() - INTERVAL '4 hours 48 minutes',
  NOW() - INTERVAL '4 hours 28 minutes',
  NOW() - INTERVAL '5 hours',
  NOW() - INTERVAL '4 hours 28 minutes'
);

-- Trip 5: Corporate ride (Ahmed, completed today)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone, customer_email,
  driver_profile_id, vehicle_id,
  corporate_account_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  actual_distance_km, actual_duration_minutes,
  ride_type, passenger_count,
  base_fare, distance_fare, time_fare, tax, tip, total_fare,
  payment_method, payment_status,
  customer_rating,
  requested_at, assigned_at, driver_arrived_at, started_at, completed_at,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-1100-000000000005',
  'b0000000-cab0-4000-a000-000000000001',
  'CCT-00005',
  5,
  'COMPLETED',
  'James Chen',
  '+14165559876',
  'james@synergydatalabs.com',
  'b0000000-cab0-4000-aa00-000000000001',
  'b0000000-cab0-4000-f000-000000000001',
  'b0000000-cab0-4000-ee00-000000000001',
  '200 Bay St, Toronto',
  43.6493,
  -79.3770,
  'Sheraton Centre, Toronto',
  43.6519,
  -79.3831,
  1.2,
  5,
  1.4,
  7,
  'standard',
  1,
  350, 245, 245, 109, 0, 949,
  'corporate',
  'COMPLETED',
  4,
  NOW() - INTERVAL '6 hours',
  NOW() - INTERVAL '5 hours 58 minutes',
  NOW() - INTERVAL '5 hours 53 minutes',
  NOW() - INTERVAL '5 hours 52 minutes',
  NOW() - INTERVAL '5 hours 45 minutes',
  NOW() - INTERVAL '6 hours',
  NOW() - INTERVAL '5 hours 45 minutes'
);

-- ── 15. Trip Ratings ──────────────────────────────────────────

INSERT INTO trip_ratings (id, trip_id, rater_type, rating, comment, tags, created_at)
VALUES
  ('b0000000-cab0-4000-2200-000000000001', 'b0000000-cab0-4000-1100-000000000001', 'customer', 5, 'Excellent driver, very smooth ride to the airport!', ARRAY['safe_driving', 'clean_car', 'friendly'], NOW() - INTERVAL '1 day'),
  ('b0000000-cab0-4000-2200-000000000002', 'b0000000-cab0-4000-1100-000000000001', 'driver', 5, 'Great passenger', ARRAY['polite', 'on_time'], NOW() - INTERVAL '1 day'),
  ('b0000000-cab0-4000-2200-000000000003', 'b0000000-cab0-4000-1100-000000000002', 'customer', 4, 'Good ride, arrived quickly', ARRAY['fast_pickup'], NOW() - INTERVAL '3 hours'),
  ('b0000000-cab0-4000-2200-000000000004', 'b0000000-cab0-4000-1100-000000000004', 'customer', 5, 'Maria was incredibly helpful and patient', ARRAY['friendly', 'helpful', 'safe_driving'], NOW() - INTERVAL '4 hours'),
  ('b0000000-cab0-4000-2200-000000000005', 'b0000000-cab0-4000-1100-000000000004', 'driver', 5, 'Very kind passenger', ARRAY['polite'], NOW() - INTERVAL '4 hours');

-- ── 16. Driver Earnings (daily summaries) ─────────────────────

-- Ahmed - yesterday
INSERT INTO driver_earnings (id, driver_profile_id, tenant_id, earning_date,
  total_trips, total_fares, total_tips, total_commission, total_net,
  online_hours, total_distance_km, cash_collected, card_collected,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-3300-000000000001',
  'b0000000-cab0-4000-aa00-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  CURRENT_DATE - 1,
  8,
  42500,   -- $425.00 total fares
  6800,    -- $68.00 tips
  8500,    -- $85.00 commission (20%)
  40800,   -- $408.00 net
  9.5,
  187.3,
  12500,   -- $125.00 cash
  30000,   -- $300.00 card
  NOW(), NOW()
);

-- Ahmed - today
INSERT INTO driver_earnings (id, driver_profile_id, tenant_id, earning_date,
  total_trips, total_fares, total_tips, total_commission, total_net,
  online_hours, total_distance_km, cash_collected, card_collected,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-3300-000000000002',
  'b0000000-cab0-4000-aa00-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  CURRENT_DATE,
  3,
  15200,
  2500,
  3040,
  14660,
  4.5,
  62.1,
  0,
  15200,
  NOW(), NOW()
);

-- Raj - yesterday
INSERT INTO driver_earnings (id, driver_profile_id, tenant_id, earning_date,
  total_trips, total_fares, total_tips, total_commission, total_net,
  online_hours, total_distance_km, cash_collected, card_collected,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-3300-000000000003',
  'b0000000-cab0-4000-aa00-000000000002',
  'b0000000-cab0-4000-a000-000000000001',
  CURRENT_DATE - 1,
  6,
  31800,
  4200,
  6360,
  29640,
  8.0,
  142.6,
  8500,
  23300,
  NOW(), NOW()
);

-- Raj - today
INSERT INTO driver_earnings (id, driver_profile_id, tenant_id, earning_date,
  total_trips, total_fares, total_tips, total_commission, total_net,
  online_hours, total_distance_km, cash_collected, card_collected,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-3300-000000000004',
  'b0000000-cab0-4000-aa00-000000000002',
  'b0000000-cab0-4000-a000-000000000001',
  CURRENT_DATE,
  2,
  8200,
  1200,
  1640,
  7760,
  3.0,
  35.8,
  1466,
  6734,
  NOW(), NOW()
);

-- Maria - today
INSERT INTO driver_earnings (id, driver_profile_id, tenant_id, earning_date,
  total_trips, total_fares, total_tips, total_commission, total_net,
  online_hours, total_distance_km, cash_collected, card_collected,
  created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-3300-000000000005',
  'b0000000-cab0-4000-aa00-000000000003',
  'b0000000-cab0-4000-a000-000000000001',
  CURRENT_DATE,
  4,
  22300,
  3800,
  4014,   -- 18% commission
  22086,
  6.5,
  95.4,
  4444,
  17856,
  NOW(), NOW()
);

-- ── 17. Trip Status Log (audit trail for completed trips) ─────

INSERT INTO trip_status_log (id, trip_id, old_status, new_status, changed_by, notes, created_at)
VALUES
  ('b0000000-cab0-4000-4400-000000000001', 'b0000000-cab0-4000-1100-000000000001', NULL, 'REQUESTED', 'customer', 'Trip requested', NOW() - INTERVAL '1 day 2 hours'),
  ('b0000000-cab0-4000-4400-000000000002', 'b0000000-cab0-4000-1100-000000000001', 'REQUESTED', 'SEARCHING', 'system', 'Searching for driver', NOW() - INTERVAL '1 day 2 hours'),
  ('b0000000-cab0-4000-4400-000000000003', 'b0000000-cab0-4000-1100-000000000001', 'SEARCHING', 'ASSIGNED', 'system', 'Driver Ahmed accepted', NOW() - INTERVAL '1 day 1 hour 57 minutes'),
  ('b0000000-cab0-4000-4400-000000000004', 'b0000000-cab0-4000-1100-000000000001', 'ASSIGNED', 'DRIVER_EN_ROUTE', 'driver', NULL, NOW() - INTERVAL '1 day 1 hour 57 minutes'),
  ('b0000000-cab0-4000-4400-000000000005', 'b0000000-cab0-4000-1100-000000000001', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'driver', NULL, NOW() - INTERVAL '1 day 1 hour 50 minutes'),
  ('b0000000-cab0-4000-4400-000000000006', 'b0000000-cab0-4000-1100-000000000001', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'driver', 'Passenger picked up', NOW() - INTERVAL '1 day 1 hour 48 minutes'),
  ('b0000000-cab0-4000-4400-000000000007', 'b0000000-cab0-4000-1100-000000000001', 'IN_PROGRESS', 'COMPLETED', 'driver', 'Trip completed at Pearson T1', NOW() - INTERVAL '1 day 1 hour 10 minutes');

-- ── 18. Support Ticket (sample) ───────────────────────────────

INSERT INTO support_tickets (id, tenant_id, trip_id, reporter_type, reporter_id,
  category, subject, description, status, priority, created_at, updated_at)
VALUES (
  'b0000000-cab0-4000-5500-000000000001',
  'b0000000-cab0-4000-a000-000000000001',
  'b0000000-cab0-4000-1100-000000000002',
  'customer',
  NULL,
  'billing',
  'Overcharged for short trip',
  'I was charged $14.66 for a 2km trip from Union Station to Eaton Centre. The minimum fare seems high for such a short distance.',
  'open',
  'normal',
  NOW() - INTERVAL '2 hours',
  NOW() - INTERVAL '2 hours'
);

-- ============================================================
-- SUMMARY
-- ============================================================
-- Tenant:     City Cab Toronto (city-cab-demo)
-- Owner:      cab@itap.zashx.com / Cab2026!
-- Dispatcher: dispatch@citycab.demo / Cab2026!
-- Drivers:
--   Ahmed Hassan  - driver1@citycab.demo / Driver1! (Toyota Camry, 4.85★)
--   Raj Patel     - driver2@citycab.demo / Driver1! (Honda CR-V, 4.62★)
--   Maria Santos  - driver3@citycab.demo / Driver1! (Dodge Grand Caravan, 4.91★)
-- Zones: Downtown, Airport (YYZ), North York/Scarborough, Mississauga
-- Fares: Standard ($3.50+$1.75/km), SUV ($5+$2.25/km), Van ($4.50+$2/km), Luxury ($8+$3/km)
-- Promos: FIRSTRIDE (50% off), SAVE5 ($5 off), AIRPORT10 (10% off airport)
-- Corporate: Synergy Data Labs ($5000 limit)
-- Sample trips: 5 completed with ratings and audit logs
-- ============================================================
