-- ============================================================
-- VELVET GLOW STUDIO - Salon Service Seed Data
-- Tenant ID: d0000000-de10-4000-a002-000000000001
-- Location ID: d0000000-de10-4000-c002-000000000001
-- Run AFTER 010_unified_demo_accounts.sql
-- ============================================================

DO $$
DECLARE
    v_tenant_id UUID := 'd0000000-de10-4000-a002-000000000001'::UUID;
    v_location_id UUID := 'd0000000-de10-4000-c002-000000000001'::UUID;

    -- Category IDs
    cat_hair UUID;
    cat_nails UUID;
    cat_skin UUID;
    cat_waxing UUID;
    cat_massage UUID;
    cat_packages UUID;

    -- Modifier Group IDs
    mg_hair_addons UUID;
    mg_nail_addons UUID;
    mg_skin_addons UUID;

    -- Product IDs (needed for product_modifier_groups linking)
    prod_haircut UUID;
    prod_coloring UUID;
    prod_blowout UUID;
    prod_highlights UUID;
    prod_balayage UUID;
    prod_mens_cut UUID;
    prod_hair_treatment UUID;
    prod_manicure UUID;
    prod_pedicure UUID;
    prod_gel_nails UUID;
    prod_gel_pedi UUID;
    prod_dip_powder UUID;
    prod_facial UUID;
    prod_chemical_peel UUID;
    prod_microderm UUID;
    prod_anti_aging UUID;
    prod_hydrafacial UUID;

BEGIN
    -- =============================================
    -- CATEGORIES
    -- =============================================
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Hair', 'Cuts, color, styling & treatments', 1, true, NOW(), NOW()) RETURNING id INTO cat_hair;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Nails', 'Manicures, pedicures & gel', 2, true, NOW(), NOW()) RETURNING id INTO cat_nails;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Skin Care', 'Facials, peels & rejuvenation', 3, true, NOW(), NOW()) RETURNING id INTO cat_skin;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Waxing', 'Full body waxing services', 4, true, NOW(), NOW()) RETURNING id INTO cat_waxing;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Massage', 'Relaxation & therapeutic massage', 5, true, NOW(), NOW()) RETURNING id INTO cat_massage;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Packages', 'Bundled service combos', 6, true, NOW(), NOW()) RETURNING id INTO cat_packages;

    -- =============================================
    -- MODIFIER GROUPS
    -- =============================================

    -- Hair Add-ons
    INSERT INTO modifier_groups (id, tenant_id, name, display_name, is_required, min_select, max_select, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Hair Add-ons', 'Enhance your hair service', false, 0, 3, 1, true, NOW(), NOW()) RETURNING id INTO mg_hair_addons;

    INSERT INTO modifiers (id, group_id, name, price, cost, sort_order, is_active, created_at) VALUES
        (gen_random_uuid(), mg_hair_addons, 'Deep Conditioning', 1500, 500, 1, true, NOW()),
        (gen_random_uuid(), mg_hair_addons, 'Scalp Massage', 1200, 200, 2, true, NOW()),
        (gen_random_uuid(), mg_hair_addons, 'Gloss Treatment', 2000, 600, 3, true, NOW()),
        (gen_random_uuid(), mg_hair_addons, 'Olaplex Treatment', 2500, 800, 4, true, NOW()),
        (gen_random_uuid(), mg_hair_addons, 'Keratin Boost', 3000, 900, 5, true, NOW());

    -- Nail Add-ons
    INSERT INTO modifier_groups (id, tenant_id, name, display_name, is_required, min_select, max_select, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Nail Add-ons', 'Add to your nail service', false, 0, 3, 2, true, NOW(), NOW()) RETURNING id INTO mg_nail_addons;

    INSERT INTO modifiers (id, group_id, name, price, cost, sort_order, is_active, created_at) VALUES
        (gen_random_uuid(), mg_nail_addons, 'Nail Art (per nail)', 1000, 300, 1, true, NOW()),
        (gen_random_uuid(), mg_nail_addons, 'Paraffin Wax', 800, 200, 2, true, NOW()),
        (gen_random_uuid(), mg_nail_addons, 'Gel Top Coat', 1200, 400, 3, true, NOW()),
        (gen_random_uuid(), mg_nail_addons, 'French Tips', 1500, 300, 4, true, NOW()),
        (gen_random_uuid(), mg_nail_addons, 'Chrome Finish', 1800, 500, 5, true, NOW());

    -- Skin Care Add-ons
    INSERT INTO modifier_groups (id, tenant_id, name, display_name, is_required, min_select, max_select, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Skin Add-ons', 'Boost your facial treatment', false, 0, 3, 3, true, NOW(), NOW()) RETURNING id INTO mg_skin_addons;

    INSERT INTO modifiers (id, group_id, name, price, cost, sort_order, is_active, created_at) VALUES
        (gen_random_uuid(), mg_skin_addons, 'LED Light Therapy', 2000, 300, 1, true, NOW()),
        (gen_random_uuid(), mg_skin_addons, 'Vitamin C Boost', 1500, 400, 2, true, NOW()),
        (gen_random_uuid(), mg_skin_addons, 'Collagen Mask', 1800, 500, 3, true, NOW()),
        (gen_random_uuid(), mg_skin_addons, 'Hyaluronic Serum', 2200, 600, 4, true, NOW());

    -- =============================================
    -- PRODUCTS — Hair Services
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_hair, 'Haircut', 'Professional haircut and styling', 3500, 500, 1500, true, true, 1, 45, true, NOW(), NOW()) RETURNING id INTO prod_haircut;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_hair, 'Hair Coloring', 'Full color treatment with premium products', 8000, 2000, 3000, true, true, 2, 120, true, NOW(), NOW()) RETURNING id INTO prod_coloring;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_hair, 'Blowout', 'Wash and blowout styling', 2500, 300, 1000, true, true, 3, 30, true, NOW(), NOW()) RETURNING id INTO prod_blowout;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_hair, 'Highlights', 'Partial or full highlights', 9500, 2500, 4000, true, true, 4, 90, true, NOW(), NOW()) RETURNING id INTO prod_highlights;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_hair, 'Balayage', 'Hand-painted highlights for a natural look', 12000, 3000, 5000, true, true, 5, 150, true, NOW(), NOW()) RETURNING id INTO prod_balayage;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_hair, 'Men''s Haircut', 'Classic men''s cut and style', 2500, 300, 1000, true, true, 6, 30, true, NOW(), NOW()) RETURNING id INTO prod_mens_cut;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_hair, 'Hair Treatment', 'Deep repair and nourishment treatment', 4500, 1200, 1500, true, true, 7, 45, true, NOW(), NOW()) RETURNING id INTO prod_hair_treatment;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_hair, 'Updo / Special Occasion', 'Formal updo styling for events', 7500, 800, 3500, true, true, 8, 60, true, NOW(), NOW());
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_hair, 'Bang Trim', 'Quick bang trim between cuts', 1000, 100, 500, true, true, 9, 15, true, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Nail Services
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_nails, 'Classic Manicure', 'Nail shaping, cuticle care, and polish', 3000, 500, 1000, true, true, 1, 30, true, NOW(), NOW()) RETURNING id INTO prod_manicure;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_nails, 'Classic Pedicure', 'Full pedicure with soak and polish', 4500, 800, 1500, true, true, 2, 45, true, NOW(), NOW()) RETURNING id INTO prod_pedicure;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_nails, 'Gel Manicure', 'UV gel polish manicure', 5000, 1000, 2000, true, true, 3, 60, true, NOW(), NOW()) RETURNING id INTO prod_gel_nails;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_nails, 'Gel Pedicure', 'UV gel polish pedicure', 5500, 1100, 2000, true, true, 4, 60, true, NOW(), NOW()) RETURNING id INTO prod_gel_pedi;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_nails, 'Dip Powder Nails', 'Long-lasting dip powder application', 6000, 1200, 2500, true, true, 5, 75, true, NOW(), NOW()) RETURNING id INTO prod_dip_powder;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_nails, 'Acrylic Full Set', 'Full set of acrylic nail extensions', 6500, 1500, 2500, true, true, 6, 90, true, NOW(), NOW());
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_nails, 'Acrylic Fill', 'Acrylic nail fill and reshape', 4500, 900, 2000, true, true, 7, 60, true, NOW(), NOW());
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_nails, 'Nail Removal', 'Gel or acrylic removal with care', 2000, 400, 800, true, true, 8, 30, true, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Skin Care Services
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_skin, 'Classic Facial', 'Deep cleansing facial treatment', 6500, 1500, 2500, true, true, 1, 60, true, NOW(), NOW()) RETURNING id INTO prod_facial;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_skin, 'Chemical Peel', 'Professional chemical peel treatment', 8500, 2500, 3000, true, true, 2, 45, true, NOW(), NOW()) RETURNING id INTO prod_chemical_peel;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_skin, 'Microdermabrasion', 'Exfoliating skin resurfacing', 9000, 2000, 3500, true, true, 3, 60, true, NOW(), NOW()) RETURNING id INTO prod_microderm;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_skin, 'Anti-Aging Facial', 'Advanced anti-aging treatment with peptides', 9500, 3000, 3500, true, true, 4, 75, true, NOW(), NOW()) RETURNING id INTO prod_anti_aging;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_skin, 'HydraFacial', 'Hydrating and cleansing facial with serums', 12000, 4000, 4000, true, true, 5, 60, true, NOW(), NOW()) RETURNING id INTO prod_hydrafacial;
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_skin, 'Acne Treatment', 'Targeted acne clearing facial', 7500, 2000, 3000, true, true, 6, 60, true, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Waxing Services
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_waxing, 'Eyebrow Wax', 'Precise eyebrow shaping', 1500, 200, 500, true, true, 1, 15, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_waxing, 'Upper Lip Wax', 'Gentle upper lip wax', 1000, 150, 300, true, true, 2, 10, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_waxing, 'Full Face Wax', 'Complete face waxing', 3500, 500, 1200, true, true, 3, 30, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_waxing, 'Underarm Wax', 'Smooth underarm wax', 2000, 300, 600, true, true, 4, 15, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_waxing, 'Half Leg Wax', 'Lower leg waxing', 3500, 500, 1200, true, true, 5, 30, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_waxing, 'Full Leg Wax', 'Complete leg waxing', 5500, 800, 2000, true, true, 6, 45, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_waxing, 'Brazilian Wax', 'Full Brazilian wax', 5000, 600, 2000, true, true, 7, 45, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_waxing, 'Full Arm Wax', 'Complete arm waxing', 3500, 500, 1200, true, true, 8, 30, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_waxing, 'Back Wax', 'Full back waxing', 5000, 600, 1800, true, true, 9, 40, true, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Massage Services
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_massage, 'Swedish Massage (60 min)', 'Full body relaxation massage', 8500, 1000, 4000, true, true, 1, 60, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_massage, 'Swedish Massage (90 min)', 'Extended full body massage', 12000, 1500, 5500, true, true, 2, 90, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_massage, 'Deep Tissue Massage', 'Targeted deep pressure massage', 9500, 1200, 4500, true, true, 3, 60, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_massage, 'Hot Stone Massage', 'Warm stone relaxation therapy', 10500, 1500, 4500, true, true, 4, 75, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_massage, 'Aromatherapy Massage', 'Essential oil massage treatment', 9000, 1500, 4000, true, true, 5, 60, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_massage, 'Head & Neck Massage', 'Focused upper body tension relief', 4500, 500, 2000, true, true, 6, 30, true, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Packages
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, labour_cost, is_active, is_available, sort_order, duration_minutes, requires_technician, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_packages, 'Glow Up Package', 'Haircut + Classic Facial + Manicure', 11500, 2500, 5000, true, true, 1, 135, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_packages, 'Bridal Package', 'Updo + Gel Manicure + Gel Pedicure + Facial', 22000, 4500, 10000, true, true, 2, 240, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_packages, 'Relaxation Retreat', 'Swedish Massage (90 min) + HydraFacial', 21000, 5500, 9500, true, true, 3, 150, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_packages, 'Pamper Me Package', 'Manicure + Pedicure + 30 min Massage', 10500, 1800, 4500, true, true, 4, 105, true, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_packages, 'Quick Refresh', 'Blowout + Eyebrow Wax + Lip Wax', 4500, 650, 1800, true, true, 5, 55, true, NOW(), NOW());

    -- =============================================
    -- LINK MODIFIER GROUPS TO PRODUCTS
    -- =============================================

    -- Hair Add-ons → all hair services
    INSERT INTO product_modifier_groups (id, product_id, modifier_group_id, sort_order) VALUES
        (gen_random_uuid(), prod_haircut, mg_hair_addons, 1),
        (gen_random_uuid(), prod_coloring, mg_hair_addons, 1),
        (gen_random_uuid(), prod_blowout, mg_hair_addons, 1),
        (gen_random_uuid(), prod_highlights, mg_hair_addons, 1),
        (gen_random_uuid(), prod_balayage, mg_hair_addons, 1),
        (gen_random_uuid(), prod_mens_cut, mg_hair_addons, 1),
        (gen_random_uuid(), prod_hair_treatment, mg_hair_addons, 1);

    -- Nail Add-ons → all nail services
    INSERT INTO product_modifier_groups (id, product_id, modifier_group_id, sort_order) VALUES
        (gen_random_uuid(), prod_manicure, mg_nail_addons, 1),
        (gen_random_uuid(), prod_pedicure, mg_nail_addons, 1),
        (gen_random_uuid(), prod_gel_nails, mg_nail_addons, 1),
        (gen_random_uuid(), prod_gel_pedi, mg_nail_addons, 1),
        (gen_random_uuid(), prod_dip_powder, mg_nail_addons, 1);

    -- Skin Add-ons → all skin care services
    INSERT INTO product_modifier_groups (id, product_id, modifier_group_id, sort_order) VALUES
        (gen_random_uuid(), prod_facial, mg_skin_addons, 1),
        (gen_random_uuid(), prod_chemical_peel, mg_skin_addons, 1),
        (gen_random_uuid(), prod_microderm, mg_skin_addons, 1),
        (gen_random_uuid(), prod_anti_aging, mg_skin_addons, 1),
        (gen_random_uuid(), prod_hydrafacial, mg_skin_addons, 1);

    RAISE NOTICE 'Velvet Glow Studio seed data inserted successfully!';
END $$;
