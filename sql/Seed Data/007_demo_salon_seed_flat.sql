-- ============================================
-- 007: Demo Salon Seed Data (flat version - no DO $$ blocks)
-- ============================================
-- Run each section in order. Copy-paste section by section.
-- Owner: salon@oreugo.ca / Salon2026!
-- Technicians: Tech2026!

-- ============================================
-- STEP 1: Create Tenant (run this first)
-- ============================================
INSERT INTO tenants (name, slug, status, currency, timezone, auth_provider, business_type, updated_at)
VALUES ('Glow Beauty Studio', 'glow-beauty-demo', 'ACTIVE', 'CAD', 'America/Toronto', 'local', 'salon', NOW())
ON CONFLICT (slug) DO NOTHING;

-- ============================================
-- STEP 2: Get your tenant ID - run this SELECT and note the id
-- ============================================
SELECT id FROM tenants WHERE slug = 'glow-beauty-demo';

-- ============================================
-- STEP 3: Replace ALL occurrences of bde9ba48-0fca-4036-bd61-323a02b3a105 below with the UUID from step 2
--         Then run each section in order
-- ============================================

-- 3a. Tenant Settings
INSERT INTO tenant_settings (
  tenant_id, tax_enabled, tax_rate, tax_label,
  tip_enabled, tip_presets, tip_custom_enabled,
  order_number_reset, kitchen_display_enabled, table_ordering_enabled,
  appointment_booking_enabled, buffer_time_minutes, booking_advance_days, walk_in_enabled,
  brand_name, brand_primary_color, updated_at
) VALUES (
  'bde9ba48-0fca-4036-bd61-323a02b3a105', true, 13.00, 'HST',
  true, '[15, 18, 20]', true,
  'DAILY', false, false,
  true, 15, 30, true,
  'Glow Beauty Studio', '#9333EA', NOW()
) ON CONFLICT (tenant_id) DO NOTHING;

-- 3b. Location
INSERT INTO locations (tenant_id, name, address, city, province, postal_code, country, status, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', 'Main Studio', '123 Beauty Ave', 'Toronto', 'ON', 'M5V 2T6', 'CA', 'ACTIVE', NOW());

-- 3c. Owner Membership
INSERT INTO memberships (
  tenant_id, user_sub, email, first_name, last_name,
  role, status, password_hash, must_change_password, activated_at, updated_at
) VALUES (
  'bde9ba48-0fca-4036-bd61-323a02b3a105', 'local-salon@oreugo.ca', 'salon@oreugo.ca', 'Sarah', 'Chen',
  'TENANT_OWNER', 'ACTIVE',
  '$2a$12$5PsgXe6IrfaVYQVUlxj5W.u3FwCh6CMOrBsFmMJGNU7TN19Nyv0aa',
  false, NOW(), NOW()
);

-- ============================================
-- STEP 4: Create Categories - run all 4
-- ============================================
INSERT INTO categories (tenant_id, name, sort_order, updated_at) VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', 'Hair', 1, NOW());
INSERT INTO categories (tenant_id, name, sort_order, updated_at) VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', 'Nails', 2, NOW());
INSERT INTO categories (tenant_id, name, sort_order, updated_at) VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', 'Skin Care', 3, NOW());
INSERT INTO categories (tenant_id, name, sort_order, updated_at) VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', 'Waxing', 4, NOW());

-- ============================================
-- STEP 5: Get category IDs - run this and note them
-- ============================================
SELECT id, name FROM categories WHERE tenant_id = 'bde9ba48-0fca-4036-bd61-323a02b3a105' ORDER BY sort_order;

-- ============================================
-- STEP 6: Create Services
--   Replace 28aa2b39-1793-4fe6-a174-ff1cf95b9bf6, fe017591-1b42-4681-979c-484f0661c2f4, 59246c35-c195-4a55-b77d-fcaf72353528 with IDs from step 5
-- ============================================

-- Hair Services
INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', '28aa2b39-1793-4fe6-a174-ff1cf95b9bf6', 'Haircut', 'Professional haircut and styling', 3500, 500, 1500, true, true, 1, 45, true, NOW());

INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', '28aa2b39-1793-4fe6-a174-ff1cf95b9bf6', 'Hair Coloring', 'Full color treatment with premium products', 8000, 2000, 3000, true, true, 2, 120, true, NOW());

INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', '28aa2b39-1793-4fe6-a174-ff1cf95b9bf6', 'Blowout', 'Wash and blowout styling', 2500, 300, 1000, true, true, 3, 30, true, NOW());

INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', '28aa2b39-1793-4fe6-a174-ff1cf95b9bf6', 'Highlights', 'Partial or full highlights', 9500, 2500, 4000, true, true, 4, 90, true, NOW());

-- Nail Services
INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', 'fe017591-1b42-4681-979c-484f0661c2f4', 'Manicure', 'Classic manicure with nail polish', 3000, 500, 1000, true, true, 1, 30, true, NOW());

INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', 'fe017591-1b42-4681-979c-484f0661c2f4', 'Pedicure', 'Full pedicure with soak and polish', 4500, 800, 1500, true, true, 2, 45, true, NOW());

INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', 'fe017591-1b42-4681-979c-484f0661c2f4', 'Gel Nails', 'UV gel nail application', 5000, 1000, 2000, true, true, 3, 60, true, NOW());

-- Skin Care Services
INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', '59246c35-c195-4a55-b77d-fcaf72353528', 'Facial', 'Deep cleansing facial treatment', 6500, 1500, 2500, true, true, 1, 60, true, NOW());

INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', '59246c35-c195-4a55-b77d-fcaf72353528', 'Chemical Peel', 'Professional chemical peel treatment', 8500, 2500, 3000, true, true, 2, 45, true, NOW());

-- ============================================
-- STEP 7: Get service/product IDs - run this and note them
-- ============================================
SELECT id, name FROM products WHERE tenant_id = 'bde9ba48-0fca-4036-bd61-323a02b3a105' ORDER BY name;

-- ============================================
-- STEP 8: Create Add-ons modifier group
-- ============================================
INSERT INTO modifier_groups (tenant_id, name, min_selections, max_selections, is_required, updated_at)
VALUES ('bde9ba48-0fca-4036-bd61-323a02b3a105', 'Add-ons', 0, 3, false, NOW());

-- Get the modifier group ID
SELECT id FROM modifier_groups WHERE tenant_id = 'bde9ba48-0fca-4036-bd61-323a02b3a105' AND name = 'Add-ons';

-- ============================================
-- STEP 9: Create modifiers - Replace __MG_ADDONS__ with the modifier group ID
-- ============================================
INSERT INTO modifiers (modifier_group_id, name, price, cost, sort_order) VALUES ('__MG_ADDONS__', 'Deep Conditioning', 1500, 500, 1);
INSERT INTO modifiers (modifier_group_id, name, price, cost, sort_order) VALUES ('__MG_ADDONS__', 'Nail Art', 1000, 300, 2);
INSERT INTO modifiers (modifier_group_id, name, price, cost, sort_order) VALUES ('__MG_ADDONS__', 'Paraffin Wax', 800, 200, 3);
INSERT INTO modifiers (modifier_group_id, name, price, cost, sort_order) VALUES ('__MG_ADDONS__', 'Scalp Massage', 1200, 200, 4);

-- ============================================
-- STEP 10: Link add-ons to services
--   Replace e3372825-ff0a-494e-8fde-164ebf007f6c, 98741baf-33a5-4ff9-9236-a6d52070b0a4, etc with product IDs from step 7
-- ============================================
INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES ('e3372825-ff0a-494e-8fde-164ebf007f6c', '__MG_ADDONS__', 1);
INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES ('98741baf-33a5-4ff9-9236-a6d52070b0a4', '__MG_ADDONS__', 1);
INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES ('4819edd8-4b45-4403-a4fa-1f72e6297014', '__MG_ADDONS__', 1);
INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES ('5e60ef54-a14b-4eb9-948c-0a593727ec59', '__MG_ADDONS__', 1);
INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES ('1668d4d4-b22b-4efc-9418-9c3211d9b193', '__MG_ADDONS__', 1);
INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES ('89cd4292-305d-4bd6-af4d-14a39395c213', '__MG_ADDONS__', 1);

-- ============================================
-- STEP 11: Create 3 Technicians
--   Replace service IDs in specialties arrays with product IDs from step 7
-- ============================================

-- Lisa Park - Hair specialist (password: Tech2026!)
INSERT INTO memberships (
  tenant_id, user_sub, email, first_name, last_name,
  role, status, password_hash, must_change_password, activated_at,
  specialties, commission_rate, updated_at
) VALUES (
  'bde9ba48-0fca-4036-bd61-323a02b3a105', 'local-lisa@oreugo.ca', 'lisa@oreugo.ca', 'Lisa', 'Park',
  'POS_STAFF', 'ACTIVE',
  '$2a$12$l094eOYTyzE.g2v4eUC.JeVtF7UDop.Jx8LW0967EHADx3oa8GzVG',
  false, NOW(),
  ARRAY['e3372825-ff0a-494e-8fde-164ebf007f6c', '98741baf-33a5-4ff9-9236-a6d52070b0a4', '4819edd8-4b45-4403-a4fa-1f72e6297014', 'c632de65-e68b-41b6-a029-6ec97c816e16'],
  40.00, NOW()
);

-- Maria Santos - Nails & Skin specialist (password: Tech2026!)
INSERT INTO memberships (
  tenant_id, user_sub, email, first_name, last_name,
  role, status, password_hash, must_change_password, activated_at,
  specialties, commission_rate, updated_at
) VALUES (
  'bde9ba48-0fca-4036-bd61-323a02b3a105', 'local-maria@oreugo.ca', 'maria@oreugo.ca', 'Maria', 'Santos',
  'POS_STAFF', 'ACTIVE',
  '$2a$12$l094eOYTyzE.g2v4eUC.JeVtF7UDop.Jx8LW0967EHADx3oa8GzVG',
  false, NOW(),
  ARRAY['5e60ef54-a14b-4eb9-948c-0a593727ec59', '1668d4d4-b22b-4efc-9418-9c3211d9b193', '89cd4292-305d-4bd6-af4d-14a39395c213', 'a8f93a76-b4a8-4bee-a5c2-70b2725366f4', '9944ec4d-7a4f-43a2-924d-21112501e812'],
  35.00, NOW()
);

-- Emma Wilson - All-rounder, no specialties = can do everything (password: Tech2026!)
INSERT INTO memberships (
  tenant_id, user_sub, email, first_name, last_name,
  role, status, password_hash, must_change_password, activated_at,
  specialties, commission_rate, updated_at
) VALUES (
  'bde9ba48-0fca-4036-bd61-323a02b3a105', 'local-emma@oreugo.ca', 'emma@oreugo.ca', 'Emma', 'Wilson',
  'POS_STAFF', 'ACTIVE',
  '$2a$12$l094eOYTyzE.g2v4eUC.JeVtF7UDop.Jx8LW0967EHADx3oa8GzVG',
  false, NOW(),
  '{}',
  45.00, NOW()
);

-- ============================================
-- DONE! Verify everything:
-- ============================================
SELECT 'Tenant' as type, id, name FROM tenants WHERE slug = 'glow-beauty-demo'
UNION ALL
SELECT 'Member', m.id, m.email FROM memberships m JOIN tenants t ON m.tenant_id = t.id WHERE t.slug = 'glow-beauty-demo'
UNION ALL
SELECT 'Service', p.id, p.name FROM products p JOIN tenants t ON p.tenant_id = t.id WHERE t.slug = 'glow-beauty-demo'
UNION ALL
SELECT 'Category', c.id, c.name FROM categories c JOIN tenants t ON c.tenant_id = t.id WHERE t.slug = 'glow-beauty-demo';
