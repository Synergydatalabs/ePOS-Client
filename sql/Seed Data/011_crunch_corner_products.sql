-- ============================================================
-- CRUNCH CORNER - Retail / Snack Bar Product Seed Data
-- Tenant ID: d0000000-de10-4000-a003-000000000001
-- Run AFTER 010_unified_demo_accounts.sql
-- ============================================================

DO $$
DECLARE
    v_tenant_id UUID := 'd0000000-de10-4000-a003-000000000001'::UUID;
    v_location_id UUID := 'd0000000-de10-4000-c003-000000000001'::UUID;

    -- Category IDs
    cat_chips UUID;
    cat_candy UUID;
    cat_drinks UUID;
    cat_ice_cream UUID;
    cat_snack_packs UUID;
    cat_fresh UUID;
    cat_combos UUID;

    -- Modifier Group IDs
    mg_size UUID;
    mg_dip UUID;
    mg_toppings UUID;

BEGIN
    -- =============================================
    -- CATEGORIES
    -- =============================================
    INSERT INTO categories (id, tenant_id, name, sort_order, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Chips & Crackers', 1, true, NOW(), NOW()) RETURNING id INTO cat_chips;

    INSERT INTO categories (id, tenant_id, name, sort_order, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Candy & Chocolate', 2, true, NOW(), NOW()) RETURNING id INTO cat_candy;

    INSERT INTO categories (id, tenant_id, name, sort_order, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Drinks', 3, true, NOW(), NOW()) RETURNING id INTO cat_drinks;

    INSERT INTO categories (id, tenant_id, name, sort_order, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Ice Cream & Frozen', 4, true, NOW(), NOW()) RETURNING id INTO cat_ice_cream;

    INSERT INTO categories (id, tenant_id, name, sort_order, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Snack Packs', 5, true, NOW(), NOW()) RETURNING id INTO cat_snack_packs;

    INSERT INTO categories (id, tenant_id, name, sort_order, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Fresh & Healthy', 6, true, NOW(), NOW()) RETURNING id INTO cat_fresh;

    INSERT INTO categories (id, tenant_id, name, sort_order, is_active, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Combos', 7, true, NOW(), NOW()) RETURNING id INTO cat_combos;

    -- =============================================
    -- MODIFIER GROUPS
    -- =============================================
    INSERT INTO modifier_groups (id, tenant_id, name, min_select, max_select, is_required, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Size', 1, 1, true, NOW(), NOW()) RETURNING id INTO mg_size;

    INSERT INTO modifier_groups (id, tenant_id, name, min_select, max_select, is_required, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Dipping Sauce', 0, 2, false, NOW(), NOW()) RETURNING id INTO mg_dip;

    INSERT INTO modifier_groups (id, tenant_id, name, min_select, max_select, is_required, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Toppings', 0, 3, false, NOW(), NOW()) RETURNING id INTO mg_toppings;

    -- =============================================
    -- MODIFIERS (options within groups)
    -- =============================================

    -- Size modifiers
    INSERT INTO modifiers (id, group_id, name, price, sort_order, is_active, created_at) VALUES
      (gen_random_uuid(), mg_size, 'Small', 0, 1, true, NOW()),
      (gen_random_uuid(), mg_size, 'Medium', 100, 2, true, NOW()),
      (gen_random_uuid(), mg_size, 'Large', 200, 3, true, NOW());

    -- Dip modifiers
    INSERT INTO modifiers (id, group_id, name, price, sort_order, is_active, created_at) VALUES
      (gen_random_uuid(), mg_dip, 'Ketchup', 0, 1, true, NOW()),
      (gen_random_uuid(), mg_dip, 'Ranch', 50, 2, true, NOW()),
      (gen_random_uuid(), mg_dip, 'Sriracha Mayo', 75, 3, true, NOW()),
      (gen_random_uuid(), mg_dip, 'Cheese Sauce', 100, 4, true, NOW());

    -- Toppings modifiers
    INSERT INTO modifiers (id, group_id, name, price, sort_order, is_active, created_at) VALUES
      (gen_random_uuid(), mg_toppings, 'Whipped Cream', 100, 1, true, NOW()),
      (gen_random_uuid(), mg_toppings, 'Sprinkles', 50, 2, true, NOW()),
      (gen_random_uuid(), mg_toppings, 'Chocolate Drizzle', 75, 3, true, NOW()),
      (gen_random_uuid(), mg_toppings, 'Caramel Sauce', 75, 4, true, NOW());

    -- =============================================
    -- PRODUCTS — Chips & Crackers
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, is_active, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, cat_chips, 'Classic Potato Chips', 'Sea salt kettle-cooked chips', 299, true, true, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_chips, 'BBQ Chips', 'Smoky barbecue flavour', 299, true, true, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_chips, 'Sour Cream & Onion', 'Tangy cream and onion chips', 299, true, true, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_chips, 'Ketchup Chips', 'Canadian classic ketchup chips', 299, true, true, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_chips, 'All Dressed Chips', 'All dressed seasoning blend', 299, true, true, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_chips, 'Nachos with Cheese', 'Warm nachos with melted cheese', 599, true, true, 6, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_chips, 'Pretzel Bites', 'Warm salted pretzel bites', 449, true, true, 7, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_chips, 'Trail Mix', 'Nuts, raisins, and chocolate chips', 399, true, true, 8, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Candy & Chocolate
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, is_active, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, cat_candy, 'Milk Chocolate Bar', 'Creamy milk chocolate', 249, true, true, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_candy, 'Dark Chocolate Bar', '70% cocoa dark chocolate', 299, true, true, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_candy, 'Gummy Bears', 'Assorted fruit gummy bears', 199, true, true, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_candy, 'Sour Keys', 'Tangy sour candy keys', 199, true, true, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_candy, 'Peanut Butter Cups', 'Chocolate peanut butter cups (2 pack)', 349, true, true, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_candy, 'Licorice', 'Red licorice twists', 249, true, true, 6, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_candy, 'Caramel Popcorn', 'Sweet caramel-coated popcorn', 349, true, true, 7, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Drinks
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, is_active, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, cat_drinks, 'Coca-Cola', 'Classic Coke can', 199, true, true, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_drinks, 'Sprite', 'Lemon-lime soda can', 199, true, true, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_drinks, 'Orange Juice', 'Fresh squeezed OJ', 349, true, true, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_drinks, 'Water Bottle', 'Spring water 500ml', 149, true, true, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_drinks, 'Iced Tea', 'Peach iced tea', 249, true, true, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_drinks, 'Energy Drink', 'Sugar-free energy drink', 399, true, true, 6, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_drinks, 'Hot Chocolate', 'Rich hot cocoa', 299, true, true, 7, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_drinks, 'Slushie', 'Blue raspberry slushie', 349, true, true, 8, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Ice Cream & Frozen
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, is_active, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, cat_ice_cream, 'Vanilla Ice Cream Cup', 'Classic vanilla scoop', 349, true, true, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_ice_cream, 'Chocolate Ice Cream Cup', 'Rich chocolate scoop', 349, true, true, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_ice_cream, 'Strawberry Sundae', 'Strawberry ice cream with whip and sauce', 499, true, true, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_ice_cream, 'Ice Cream Sandwich', 'Cookies and cream sandwich', 299, true, true, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_ice_cream, 'Frozen Yogurt', 'Low-fat vanilla frozen yogurt', 399, true, true, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_ice_cream, 'Popsicle', 'Fruit popsicle (orange or grape)', 199, true, true, 6, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Snack Packs
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, is_active, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, cat_snack_packs, 'Movie Night Pack', 'Popcorn + 2 candy + 2 drinks', 999, true, true, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_snack_packs, 'Kids Snack Pack', 'Juice box + gummies + crackers', 499, true, true, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_snack_packs, 'Party Pack (10 pcs)', 'Assorted chips and candy for sharing', 1499, true, true, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_snack_packs, 'Study Fuel Pack', 'Trail mix + energy drink + chocolate', 699, true, true, 4, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Fresh & Healthy
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, is_active, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, cat_fresh, 'Fruit Cup', 'Mixed seasonal fresh fruit', 399, true, true, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_fresh, 'Veggie Sticks & Hummus', 'Carrots, celery, and hummus dip', 449, true, true, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_fresh, 'Granola Bar', 'Oats and honey granola bar', 249, true, true, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_fresh, 'Protein Bar', 'Chocolate peanut butter protein bar', 349, true, true, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_fresh, 'Apple Slices with Caramel', 'Fresh apple slices with caramel dip', 349, true, true, 5, NOW(), NOW());

    -- =============================================
    -- PRODUCTS — Combos
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, is_active, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, cat_combos, 'Chips & Drink Combo', 'Any chips + any can drink', 449, true, true, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_combos, 'Sweet Tooth Combo', 'Any chocolate + ice cream cup', 549, true, true, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_combos, 'Nachos & Slushie', 'Nachos with cheese + slushie', 849, true, true, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, cat_combos, 'Snacker Combo', 'Pretzel bites + cheese sauce + drink', 749, true, true, 4, NOW(), NOW());

    RAISE NOTICE 'Crunch Corner seed data inserted successfully!';
END $$;
