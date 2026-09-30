-- ============================================================
-- DASH RIDES TORONTO — Cab data (drivers, vehicles, zones, trips, fares, promos)
-- Tenant: d0000000-de10-4000-a004-000000000001
-- This seeds all cab-specific tables for the demo tenant
-- ============================================================

-- ── 1. Driver Memberships ────────────────────────────────────
-- These are staff members who will be linked as drivers

-- Driver 1: Ahmed Hassan
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e004-000000000010',
  'd0000000-de10-4000-a004-000000000001',
  'local-ahmed@dashrides.demo',
  'ahmed@dashrides.demo',
  'Ahmed', 'Hassan',
  'POS_STAFF', 'ACTIVE',
  '$2a$12$IHkJ2I7Tm27D0qP2Q//W7e0HWR8jkIyX6H9H//jD2RsDulUzgcK3K',
  false, NOW(), NOW(), NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Driver 2: Raj Patel
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e004-000000000011',
  'd0000000-de10-4000-a004-000000000001',
  'local-raj@dashrides.demo',
  'raj@dashrides.demo',
  'Raj', 'Patel',
  'POS_STAFF', 'ACTIVE',
  '$2a$12$IHkJ2I7Tm27D0qP2Q//W7e0HWR8jkIyX6H9H//jD2RsDulUzgcK3K',
  false, NOW(), NOW(), NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Driver 3: Maria Santos
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e004-000000000012',
  'd0000000-de10-4000-a004-000000000001',
  'local-maria@dashrides.demo',
  'maria@dashrides.demo',
  'Maria', 'Santos',
  'POS_STAFF', 'ACTIVE',
  '$2a$12$IHkJ2I7Tm27D0qP2Q//W7e0HWR8jkIyX6H9H//jD2RsDulUzgcK3K',
  false, NOW(), NOW(), NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Dispatcher: Sarah Kim
INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status,
  password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-e004-000000000020',
  'd0000000-de10-4000-a004-000000000001',
  'local-sarah@dashrides.demo',
  'sarah@dashrides.demo',
  'Sarah', 'Kim',
  'POS_ADMIN', 'ACTIVE',
  '$2a$12$IHkJ2I7Tm27D0qP2Q//W7e0HWR8jkIyX6H9H//jD2RsDulUzgcK3K',
  false, NOW(), NOW(), NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ── 2. Vehicles ──────────────────────────────────────────────

INSERT INTO vehicles (id, tenant_id, plate_number, make, model, year, color, vehicle_type, status, capacity, created_at, updated_at)
VALUES
  ('d0000000-de10-4000-f004-000000000001', 'd0000000-de10-4000-a004-000000000001',
   'DASH 001', 'Toyota', 'Camry', 2024, 'White', 'sedan', 'active', 4, NOW(), NOW()),

  ('d0000000-de10-4000-f004-000000000002', 'd0000000-de10-4000-a004-000000000001',
   'DASH 002', 'Honda', 'CR-V', 2024, 'Black', 'suv', 'active', 5, NOW(), NOW()),

  ('d0000000-de10-4000-f004-000000000003', 'd0000000-de10-4000-a004-000000000001',
   'DASH 003', 'Dodge', 'Grand Caravan', 2023, 'Silver', 'van', 'active', 7, NOW(), NOW()),

  ('d0000000-de10-4000-f004-000000000004', 'd0000000-de10-4000-a004-000000000001',
   'DASH 004', 'Mercedes', 'E-Class', 2025, 'Black', 'luxury', 'active', 4, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;


-- ── 3. Driver Profiles ───────────────────────────────────────

-- Ahmed - experienced, high rating, Toyota Camry
INSERT INTO driver_profiles (id, tenant_id, membership_id, vehicle_id, duty_status, is_available,
  license_number, license_expiry, rating, total_trips, total_earnings,
  acceptance_rate, cancellation_rate, commission_type, commission_value,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-aa04-000000000001',
  'd0000000-de10-4000-a004-000000000001',
  'd0000000-de10-4000-e004-000000000010',
  'd0000000-de10-4000-f004-000000000001',
  'online', true,
  'H1234-56789-01234', '2027-08-15',
  4.85, 1247, 287500,
  94.50, 2.10, 'percentage', 20.00,
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Raj - mid-level, Honda CR-V
INSERT INTO driver_profiles (id, tenant_id, membership_id, vehicle_id, duty_status, is_available,
  license_number, license_expiry, rating, total_trips, total_earnings,
  acceptance_rate, cancellation_rate, commission_type, commission_value,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-aa04-000000000002',
  'd0000000-de10-4000-a004-000000000001',
  'd0000000-de10-4000-e004-000000000011',
  'd0000000-de10-4000-f004-000000000002',
  'online', true,
  'P9876-54321-09876', '2027-11-30',
  4.62, 832, 198400,
  88.30, 4.50, 'percentage', 20.00,
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Maria - van driver, Dodge Grand Caravan
INSERT INTO driver_profiles (id, tenant_id, membership_id, vehicle_id, duty_status, is_available,
  license_number, license_expiry, rating, total_trips, total_earnings,
  acceptance_rate, cancellation_rate, commission_type, commission_value,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-aa04-000000000003',
  'd0000000-de10-4000-a004-000000000001',
  'd0000000-de10-4000-e004-000000000012',
  'd0000000-de10-4000-f004-000000000003',
  'offline', false,
  'S5555-12345-67890', '2028-03-20',
  4.91, 654, 163500,
  96.20, 1.30, 'percentage', 18.00,
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ── 4. Zones ─────────────────────────────────────────────────

INSERT INTO zones (id, tenant_id, name, zone_type, description, is_active,
  surcharge_type, surcharge_amount, created_at, updated_at)
VALUES
  ('d0000000-de10-4000-bb04-000000000001', 'd0000000-de10-4000-a004-000000000001',
   'Downtown Core', 'downtown',
   'Financial District, Entertainment District, Harbourfront',
   true, 'none', 0, NOW(), NOW()),

  ('d0000000-de10-4000-bb04-000000000002', 'd0000000-de10-4000-a004-000000000001',
   'Pearson Airport (YYZ)', 'airport',
   'Toronto Pearson International Airport - Terminals 1 & 3',
   true, 'flat', 500, NOW(), NOW()),

  ('d0000000-de10-4000-bb04-000000000003', 'd0000000-de10-4000-a004-000000000001',
   'North York & Scarborough', 'suburb',
   'North York, Scarborough, Don Mills',
   true, 'none', 0, NOW(), NOW()),

  ('d0000000-de10-4000-bb04-000000000004', 'd0000000-de10-4000-a004-000000000001',
   'Mississauga', 'suburb',
   'Square One, Port Credit, Streetsville',
   true, 'percentage', 500, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;


-- ── 5. Fare Rules ────────────────────────────────────────────

-- Standard Sedan
INSERT INTO fare_rules (id, tenant_id, name, vehicle_type, is_default, is_active,
  base_fare, per_km_rate, per_minute_rate, minimum_fare,
  waiting_rate_per_minute, free_waiting_minutes,
  long_distance_km, long_distance_rate,
  peak_multiplier, night_multiplier, weekend_multiplier,
  cancellation_fee, free_cancel_minutes,
  peak_hours,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-cc04-000000000001',
  'd0000000-de10-4000-a004-000000000001',
  'Standard Fare', 'sedan', true, true,
  350, 175, 35, 700,
  50, 3,
  30, 150,
  1.50, 1.25, 1.10,
  500, 3,
  '{"start":"07:00","end":"09:30"}'::jsonb,
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

-- SUV Premium
INSERT INTO fare_rules (id, tenant_id, name, vehicle_type, is_default, is_active,
  base_fare, per_km_rate, per_minute_rate, minimum_fare,
  waiting_rate_per_minute, free_waiting_minutes,
  peak_multiplier, night_multiplier, weekend_multiplier,
  cancellation_fee, free_cancel_minutes,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-cc04-000000000002',
  'd0000000-de10-4000-a004-000000000001',
  'SUV / Premium Fare', 'suv', false, true,
  500, 225, 45, 1000,
  60, 3,
  1.50, 1.25, 1.10,
  700, 3,
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Van / Accessible
INSERT INTO fare_rules (id, tenant_id, name, vehicle_type, is_default, is_active,
  base_fare, per_km_rate, per_minute_rate, minimum_fare,
  waiting_rate_per_minute, free_waiting_minutes,
  peak_multiplier, night_multiplier, weekend_multiplier,
  cancellation_fee, free_cancel_minutes,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-cc04-000000000003',
  'd0000000-de10-4000-a004-000000000001',
  'Van / Accessible Fare', 'van', false, true,
  450, 200, 40, 900,
  50, 5,
  1.30, 1.15, 1.00,
  0, 5,
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Luxury
INSERT INTO fare_rules (id, tenant_id, name, vehicle_type, is_default, is_active,
  base_fare, per_km_rate, per_minute_rate, minimum_fare,
  waiting_rate_per_minute, free_waiting_minutes,
  peak_multiplier, night_multiplier, weekend_multiplier,
  cancellation_fee, free_cancel_minutes,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-cc04-000000000004',
  'd0000000-de10-4000-a004-000000000001',
  'Luxury Fare', 'luxury', false, true,
  800, 300, 60, 1500,
  75, 5,
  1.75, 1.35, 1.15,
  1000, 5,
  NOW(), NOW()
)
ON CONFLICT (id) DO NOTHING;


-- ── 6. Promo Codes ───────────────────────────────────────────

INSERT INTO promo_codes (id, tenant_id, code, description, discount_type, discount_value,
  max_discount, max_uses, max_uses_per_user, current_uses, is_active,
  first_ride_only, valid_from, valid_until, created_at, updated_at)
VALUES
  ('d0000000-de10-4000-dd04-000000000001', 'd0000000-de10-4000-a004-000000000001',
   'FIRSTRIDE', 'First ride - 50% off up to $15', 'percentage', 50,
   1500, 1000, 1, 12, true, true,
   NOW(), '2026-12-31', NOW(), NOW()),

  ('d0000000-de10-4000-dd04-000000000002', 'd0000000-de10-4000-a004-000000000001',
   'SAVE5', '$5 off any ride', 'flat', 500,
   500, 500, 3, 45, true, false,
   NOW(), '2026-12-31', NOW(), NOW()),

  ('d0000000-de10-4000-dd04-000000000003', 'd0000000-de10-4000-a004-000000000001',
   'AIRPORT10', '10% off airport rides', 'percentage', 10,
   1000, 200, 5, 8, true, false,
   NOW(), '2026-12-31', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;


-- ── 7. Sample Completed Trips ────────────────────────────────

-- Trip 1: Downtown to Airport (Ahmed, completed yesterday)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone,
  driver_profile_id, vehicle_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  actual_distance_km, actual_duration_minutes,
  ride_type, passenger_count, luggage,
  base_fare, distance_fare, time_fare, surcharge, tax_amount, tip_amount, total,
  payment_method, payment_status,
  customer_rating, driver_rating,
  requested_at, assigned_at, driver_arrived_at, started_at, completed_at,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-1104-000000000001',
  'd0000000-de10-4000-a004-000000000001',
  'DSH-00001', 1, 'COMPLETED',
  'Michael Brown', '+14165551001',
  'd0000000-de10-4000-aa04-000000000001',
  'd0000000-de10-4000-f004-000000000001',
  '100 King St W, Toronto', 43.6488, -79.3832,
  'Pearson Airport Terminal 1', 43.6777, -79.6248,
  28.5, 35, 29.2, 38,
  'standard', 1, true,
  350, 5110, 1330, 500, 947, 500, 8737,
  'card_online', 'COMPLETED',
  5, 5,
  NOW() - INTERVAL '1 day 2 hours',
  NOW() - INTERVAL '1 day 1 hour 57 minutes',
  NOW() - INTERVAL '1 day 1 hour 50 minutes',
  NOW() - INTERVAL '1 day 1 hour 48 minutes',
  NOW() - INTERVAL '1 day 1 hour 10 minutes',
  NOW() - INTERVAL '1 day 2 hours',
  NOW() - INTERVAL '1 day 1 hour 10 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- Trip 2: Short downtown ride (Raj, completed today)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone, customer_email,
  driver_profile_id, vehicle_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  actual_distance_km, actual_duration_minutes,
  ride_type, passenger_count,
  base_fare, distance_fare, time_fare, tax_amount, tip_amount, total,
  payment_method, payment_status,
  customer_rating,
  requested_at, assigned_at, driver_arrived_at, started_at, completed_at,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-1104-000000000002',
  'd0000000-de10-4000-a004-000000000001',
  'DSH-00002', 2, 'COMPLETED',
  'Lisa Wang', '+14165551002', 'lisa.wang@email.com',
  'd0000000-de10-4000-aa04-000000000002',
  'd0000000-de10-4000-f004-000000000002',
  'Union Station, Toronto', 43.6453, -79.3806,
  'Eaton Centre, Toronto', 43.6544, -79.3807,
  2.1, 8, 2.4, 10,
  'standard', 2,
  350, 420, 350, 146, 200, 1466,
  'cash', 'COMPLETED',
  4,
  NOW() - INTERVAL '3 hours',
  NOW() - INTERVAL '2 hours 58 minutes',
  NOW() - INTERVAL '2 hours 52 minutes',
  NOW() - INTERVAL '2 hours 50 minutes',
  NOW() - INTERVAL '2 hours 40 minutes',
  NOW() - INTERVAL '3 hours',
  NOW() - INTERVAL '2 hours 40 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- Trip 3: SUV ride, North York to downtown (Raj, completed yesterday)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone,
  driver_profile_id, vehicle_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  actual_distance_km, actual_duration_minutes,
  ride_type, passenger_count, luggage,
  base_fare, distance_fare, time_fare, tax_amount, tip_amount, total,
  payment_method, payment_status,
  customer_rating, driver_rating,
  requested_at, assigned_at, driver_arrived_at, started_at, completed_at,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-1104-000000000003',
  'd0000000-de10-4000-a004-000000000001',
  'DSH-00003', 3, 'COMPLETED',
  'David Kim', '+14165551003',
  'd0000000-de10-4000-aa04-000000000002',
  'd0000000-de10-4000-f004-000000000002',
  'Yorkdale Mall, North York', 43.7254, -79.4522,
  'CN Tower, Toronto', 43.6426, -79.3871,
  15.3, 22, 16.1, 25,
  'premium', 3, true,
  500, 3623, 1125, 682, 800, 6730,
  'card_online', 'COMPLETED',
  5, 4,
  NOW() - INTERVAL '1 day 5 hours',
  NOW() - INTERVAL '1 day 4 hours 57 minutes',
  NOW() - INTERVAL '1 day 4 hours 50 minutes',
  NOW() - INTERVAL '1 day 4 hours 48 minutes',
  NOW() - INTERVAL '1 day 4 hours 23 minutes',
  NOW() - INTERVAL '1 day 5 hours',
  NOW() - INTERVAL '1 day 4 hours 23 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- Trip 4: Accessible van ride (Maria, completed today)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone,
  driver_profile_id, vehicle_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  actual_distance_km, actual_duration_minutes,
  ride_type, passenger_count,
  base_fare, distance_fare, time_fare, tax_amount, tip_amount, total,
  payment_method, payment_status,
  customer_rating, driver_rating,
  requested_at, assigned_at, driver_arrived_at, started_at, completed_at,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-1104-000000000004',
  'd0000000-de10-4000-a004-000000000001',
  'DSH-00004', 4, 'COMPLETED',
  'Robert Johnson', '+14165551004',
  'd0000000-de10-4000-aa04-000000000003',
  'd0000000-de10-4000-f004-000000000003',
  'Sunnybrook Hospital, Toronto', 43.7224, -79.3697,
  '45 Elm St, Toronto', 43.6589, -79.3831,
  10.5, 18, 11.2, 20,
  'accessible', 1,
  450, 2240, 800, 454, 500, 4444,
  'card_in_cab', 'COMPLETED',
  5, 5,
  NOW() - INTERVAL '5 hours',
  NOW() - INTERVAL '4 hours 58 minutes',
  NOW() - INTERVAL '4 hours 50 minutes',
  NOW() - INTERVAL '4 hours 48 minutes',
  NOW() - INTERVAL '4 hours 28 minutes',
  NOW() - INTERVAL '5 hours',
  NOW() - INTERVAL '4 hours 28 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- Trip 5: Active trip - SEARCHING (no driver yet)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  estimated_fare,
  ride_type, passenger_count,
  payment_method,
  requested_at,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-1104-000000000005',
  'd0000000-de10-4000-a004-000000000001',
  'DSH-00005', 5, 'SEARCHING',
  'Emily Chen', '+14165551005',
  '250 Dundas St W, Toronto', 43.6535, -79.3883,
  'Scarborough Town Centre', 43.7764, -79.2318,
  22.0, 30,
  4500,
  'standard', 1,
  'card_online',
  NOW() - INTERVAL '5 minutes',
  NOW() - INTERVAL '5 minutes',
  NOW() - INTERVAL '5 minutes'
)
ON CONFLICT (id) DO NOTHING;

-- Trip 6: Active trip - IN_PROGRESS (Ahmed driving)
INSERT INTO trips (id, tenant_id, trip_number, display_number, status,
  customer_name, customer_phone,
  driver_profile_id, vehicle_id,
  pickup_address, pickup_lat, pickup_lng,
  dropoff_address, dropoff_lat, dropoff_lng,
  estimated_distance_km, estimated_duration_minutes,
  estimated_fare,
  ride_type, passenger_count,
  payment_method,
  requested_at, assigned_at, driver_arrived_at, started_at,
  created_at, updated_at)
VALUES (
  'd0000000-de10-4000-1104-000000000006',
  'd0000000-de10-4000-a004-000000000001',
  'DSH-00006', 6, 'IN_PROGRESS',
  'Sarah Thompson', '+14165551006',
  'd0000000-de10-4000-aa04-000000000001',
  'd0000000-de10-4000-f004-000000000001',
  'Rogers Centre, Toronto', 43.6414, -79.3894,
  'Distillery District, Toronto', 43.6503, -79.3596,
  5.5, 15,
  2200,
  'standard', 2,
  'cash',
  NOW() - INTERVAL '20 minutes',
  NOW() - INTERVAL '18 minutes',
  NOW() - INTERVAL '12 minutes',
  NOW() - INTERVAL '10 minutes',
  NOW() - INTERVAL '20 minutes',
  NOW() - INTERVAL '10 minutes'
)
ON CONFLICT (id) DO NOTHING;


-- ── 8. Support Ticket (sample) ───────────────────────────────

INSERT INTO support_tickets (id, tenant_id, trip_id, reporter_type,
  reporter_name, reporter_phone,
  category, subject, description, status, priority, created_at, updated_at)
VALUES (
  'd0000000-de10-4000-5504-000000000001',
  'd0000000-de10-4000-a004-000000000001',
  'd0000000-de10-4000-1104-000000000002',
  'customer',
  'Lisa Wang', '+14165551002',
  'billing',
  'Overcharged for short trip',
  'I was charged $14.66 for a 2km trip from Union Station to Eaton Centre. The minimum fare seems too high for such a short distance.',
  'open', 'normal',
  NOW() - INTERVAL '2 hours',
  NOW() - INTERVAL '2 hours'
)
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- SUMMARY
-- ============================================================
-- Tenant: Dash Rides Toronto (d0000000-de10-4000-a004-000000000001)
--
-- Staff:
--   Ahmed Hassan  - ahmed@dashrides.demo  / Demo2026! (Driver, online)
--   Raj Patel     - raj@dashrides.demo    / Demo2026! (Driver, online)
--   Maria Santos  - maria@dashrides.demo  / Demo2026! (Driver, offline)
--   Sarah Kim     - sarah@dashrides.demo  / Demo2026! (Dispatcher)
--
-- Vehicles: Toyota Camry, Honda CR-V, Dodge Grand Caravan, Mercedes E-Class
-- Drivers: 3 with profiles (Ahmed 4.85★, Raj 4.62★, Maria 4.91★)
-- Zones: Downtown, Airport (YYZ), North York/Scarborough, Mississauga
-- Fares: Sedan $3.50+$1.75/km, SUV $5+$2.25/km, Van $4.50+$2/km, Luxury $8+$3/km
-- Promos: FIRSTRIDE (50% off), SAVE5 ($5 off), AIRPORT10 (10% off)
-- Trips: 4 completed + 1 searching + 1 in-progress (active)
-- Support: 1 open ticket
-- ============================================================
