-- ============================================
-- 007: Demo Salon Seed Data
-- ============================================
-- Creates "Glow Beauty Studio" demo salon tenant
-- Owner: salon@itap.zashx.com / Salon2026!
-- 3 Technicians: Tech2026!
-- Run AFTER 006_salon_business_type.sql

-- 1. Create Tenant
INSERT INTO tenants (name, slug, status, currency, timezone, auth_provider, business_type)
VALUES ('Glow Beauty Studio', 'glow-beauty-demo', 'ACTIVE', 'CAD', 'America/Toronto', 'local', 'salon')
ON CONFLICT (slug) DO NOTHING;

-- Get the tenant ID for subsequent inserts
DO $$
DECLARE
  v_tenant_id UUID;
  v_location_id UUID;
  v_owner_id UUID;
  v_cat_hair UUID;
  v_cat_nails UUID;
  v_cat_skin UUID;
  v_cat_waxing UUID;
  v_svc_haircut UUID;
  v_svc_coloring UUID;
  v_svc_blowout UUID;
  v_svc_highlights UUID;
  v_svc_manicure UUID;
  v_svc_pedicure UUID;
  v_svc_gelnails UUID;
  v_svc_facial UUID;
  v_svc_chemical_peel UUID;
  v_tech1_id UUID;
  v_tech2_id UUID;
  v_tech3_id UUID;
  v_mg_addons UUID;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE slug = 'glow-beauty-demo';

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant glow-beauty-demo not found';
  END IF;

  -- 2. Create Tenant Settings
  INSERT INTO tenant_settings (
    tenant_id, tax_enabled, tax_rate, tax_label,
    tip_enabled, tip_presets, tip_custom_enabled,
    order_number_reset, kitchen_display_enabled, table_ordering_enabled,
    appointment_booking_enabled, buffer_time_minutes, booking_advance_days, walk_in_enabled,
    brand_name, brand_primary_color
  ) VALUES (
    v_tenant_id, true, 13.00, 'HST',
    true, '[15, 18, 20]', true,
    'DAILY', false, false,
    true, 15, 30, true,
    'Glow Beauty Studio', '#9333EA'
  ) ON CONFLICT (tenant_id) DO NOTHING;

  -- 3. Create Location
  INSERT INTO locations (tenant_id, name, address, city, province, postal_code, country, status)
  VALUES (v_tenant_id, 'Main Studio', '123 Beauty Ave', 'Toronto', 'ON', 'M5V 2T6', 'CA', 'ACTIVE')
  RETURNING id INTO v_location_id;

  -- 4. Create Owner Membership
  INSERT INTO memberships (
    tenant_id, user_sub, email, first_name, last_name,
    role, status, password_hash, must_change_password, activated_at
  ) VALUES (
    v_tenant_id, 'local-salon@itap.zashx.com', 'salon@itap.zashx.com', 'Sarah', 'Chen',
    'TENANT_OWNER', 'ACTIVE',
    '$2a$12$5PsgXe6IrfaVYQVUlxj5W.u3FwCh6CMOrBsFmMJGNU7TN19Nyv0aa',
    false, NOW()
  ) RETURNING id INTO v_owner_id;

  -- 5. Create Categories (Service Types)
  INSERT INTO categories (tenant_id, name, sort_order) VALUES (v_tenant_id, 'Hair', 1) RETURNING id INTO v_cat_hair;
  INSERT INTO categories (tenant_id, name, sort_order) VALUES (v_tenant_id, 'Nails', 2) RETURNING id INTO v_cat_nails;
  INSERT INTO categories (tenant_id, name, sort_order) VALUES (v_tenant_id, 'Skin Care', 3) RETURNING id INTO v_cat_skin;
  INSERT INTO categories (tenant_id, name, sort_order) VALUES (v_tenant_id, 'Waxing', 4) RETURNING id INTO v_cat_waxing;

  -- 6. Create Services (Products with duration)
  -- Hair Services
  INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician)
  VALUES (v_tenant_id, v_cat_hair, 'Haircut', 'Professional haircut and styling', 3500, 500, 1500, true, true, 1, 45, true) RETURNING id INTO v_svc_haircut;

  INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician)
  VALUES (v_tenant_id, v_cat_hair, 'Hair Coloring', 'Full color treatment with premium products', 8000, 2000, 3000, true, true, 2, 120, true) RETURNING id INTO v_svc_coloring;

  INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician)
  VALUES (v_tenant_id, v_cat_hair, 'Blowout', 'Wash and blowout styling', 2500, 300, 1000, true, true, 3, 30, true) RETURNING id INTO v_svc_blowout;

  INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician)
  VALUES (v_tenant_id, v_cat_hair, 'Highlights', 'Partial or full highlights', 9500, 2500, 4000, true, true, 4, 90, true) RETURNING id INTO v_svc_highlights;

  -- Nail Services
  INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician)
  VALUES (v_tenant_id, v_cat_nails, 'Manicure', 'Classic manicure with nail polish', 3000, 500, 1000, true, true, 1, 30, true) RETURNING id INTO v_svc_manicure;

  INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician)
  VALUES (v_tenant_id, v_cat_nails, 'Pedicure', 'Full pedicure with soak and polish', 4500, 800, 1500, true, true, 2, 45, true) RETURNING id INTO v_svc_pedicure;

  INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician)
  VALUES (v_tenant_id, v_cat_nails, 'Gel Nails', 'UV gel nail application', 5000, 1000, 2000, true, true, 3, 60, true) RETURNING id INTO v_svc_gelnails;

  -- Skin Care Services
  INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician)
  VALUES (v_tenant_id, v_cat_skin, 'Facial', 'Deep cleansing facial treatment', 6500, 1500, 2500, true, true, 1, 60, true) RETURNING id INTO v_svc_facial;

  INSERT INTO products (tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician)
  VALUES (v_tenant_id, v_cat_skin, 'Chemical Peel', 'Professional chemical peel treatment', 8500, 2500, 3000, true, true, 2, 45, true) RETURNING id INTO v_svc_chemical_peel;

  -- 7. Create Modifier Group (Add-ons)
  INSERT INTO modifier_groups (tenant_id, name, min_selections, max_selections, is_required)
  VALUES (v_tenant_id, 'Add-ons', 0, 3, false) RETURNING id INTO v_mg_addons;

  INSERT INTO modifiers (modifier_group_id, name, price, cost, sort_order) VALUES (v_mg_addons, 'Deep Conditioning', 1500, 500, 1);
  INSERT INTO modifiers (modifier_group_id, name, price, cost, sort_order) VALUES (v_mg_addons, 'Nail Art', 1000, 300, 2);
  INSERT INTO modifiers (modifier_group_id, name, price, cost, sort_order) VALUES (v_mg_addons, 'Paraffin Wax', 800, 200, 3);
  INSERT INTO modifiers (modifier_group_id, name, price, cost, sort_order) VALUES (v_mg_addons, 'Scalp Massage', 1200, 200, 4);

  -- Link add-ons to hair and nail services
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES (v_svc_haircut, v_mg_addons, 1);
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES (v_svc_coloring, v_mg_addons, 1);
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES (v_svc_blowout, v_mg_addons, 1);
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES (v_svc_manicure, v_mg_addons, 1);
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES (v_svc_pedicure, v_mg_addons, 1);
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order) VALUES (v_svc_gelnails, v_mg_addons, 1);

  -- 8. Create 3 Technicians
  -- Tech 1: Lisa Park - Hair specialist
  INSERT INTO memberships (
    tenant_id, user_sub, email, first_name, last_name,
    role, status, password_hash, must_change_password, activated_at,
    specialties, commission_rate
  ) VALUES (
    v_tenant_id, 'local-lisa@glowbeauty.ca', 'lisa@glowbeauty.ca', 'Lisa', 'Park',
    'POS_STAFF', 'ACTIVE',
    '$2a$12$l094eOYTyzE.g2v4eUC.JeVtF7UDop.Jx8LW0967EHADx3oa8GzVG',
    false, NOW(),
    ARRAY[v_svc_haircut::text, v_svc_coloring::text, v_svc_blowout::text, v_svc_highlights::text],
    40.00
  ) RETURNING id INTO v_tech1_id;

  -- Tech 2: Maria Santos - Nails & Skin specialist
  INSERT INTO memberships (
    tenant_id, user_sub, email, first_name, last_name,
    role, status, password_hash, must_change_password, activated_at,
    specialties, commission_rate
  ) VALUES (
    v_tenant_id, 'local-maria@glowbeauty.ca', 'maria@glowbeauty.ca', 'Maria', 'Santos',
    'POS_STAFF', 'ACTIVE',
    '$2a$12$l094eOYTyzE.g2v4eUC.JeVtF7UDop.Jx8LW0967EHADx3oa8GzVG',
    false, NOW(),
    ARRAY[v_svc_manicure::text, v_svc_pedicure::text, v_svc_gelnails::text, v_svc_facial::text, v_svc_chemical_peel::text],
    35.00
  ) RETURNING id INTO v_tech2_id;

  -- Tech 3: Emma Wilson - All-rounder (no specialty filter = can do everything)
  INSERT INTO memberships (
    tenant_id, user_sub, email, first_name, last_name,
    role, status, password_hash, must_change_password, activated_at,
    specialties, commission_rate
  ) VALUES (
    v_tenant_id, 'local-emma@glowbeauty.ca', 'emma@glowbeauty.ca', 'Emma', 'Wilson',
    'POS_STAFF', 'ACTIVE',
    '$2a$12$l094eOYTyzE.g2v4eUC.JeVtF7UDop.Jx8LW0967EHADx3oa8GzVG',
    false, NOW(),
    '{}',
    45.00
  ) RETURNING id INTO v_tech3_id;

  RAISE NOTICE 'Demo salon created successfully!';
  RAISE NOTICE 'Tenant ID: %', v_tenant_id;
  RAISE NOTICE 'Owner: salon@itap.zashx.com / Salon2026!';
  RAISE NOTICE 'Technicians (all use Tech2026!):';
  RAISE NOTICE '  Lisa Park (Hair): lisa@glowbeauty.ca';
  RAISE NOTICE '  Maria Santos (Nails/Skin): maria@glowbeauty.ca';
  RAISE NOTICE '  Emma Wilson (All): emma@glowbeauty.ca';
END $$;
