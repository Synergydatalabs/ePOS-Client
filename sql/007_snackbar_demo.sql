-- ============================================
-- Snack Bar Co — Demo Retail Tenant
-- Business Type: retail
-- Owner: snackbar@itap.zashx.com / Snack2026!
-- Staff: staff@snackbar.demo / Staff2026!
-- ============================================
-- No schema changes needed — "retail" is just a
-- value in the existing business_type VARCHAR column.
-- ============================================

DO $$
DECLARE
  v_tenant_id UUID;
  v_location_id UUID;
  v_owner_id UUID;
  v_staff_id UUID;
  v_cat_candy UUID;
  v_cat_chips UUID;
  v_cat_chocolate UUID;
  v_cat_cereal UUID;
  v_cat_cookies UUID;
  v_cat_drinks UUID;
  v_cat_theatre UUID;
  v_cat_sauce UUID;
  v_cat_ramen UUID;
BEGIN

  -- 1. Create tenant (skip if exists)
  SELECT id INTO v_tenant_id FROM tenants WHERE slug = 'snack-bar-co';

  IF v_tenant_id IS NULL THEN
    INSERT INTO tenants (id, name, slug, currency, timezone, status, business_type, auth_provider, created_at, updated_at)
    VALUES (gen_random_uuid(), 'Snack Bar Co', 'snack-bar-co', 'CAD', 'America/Toronto', 'ACTIVE', 'retail', 'local', NOW(), NOW())
    RETURNING id INTO v_tenant_id;
  END IF;

  -- 2. Create location
  SELECT id INTO v_location_id FROM locations WHERE tenant_id = v_tenant_id LIMIT 1;
  IF v_location_id IS NULL THEN
    INSERT INTO locations (id, tenant_id, name, is_default, status, country, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'Main Store', TRUE, 'ACTIVE', 'CA', NOW(), NOW())
    RETURNING id INTO v_location_id;
  END IF;

  -- 3. Create owner membership (password: Snack2026!)
  SELECT id INTO v_owner_id FROM memberships WHERE tenant_id = v_tenant_id AND role = 'TENANT_OWNER' LIMIT 1;
  IF v_owner_id IS NULL THEN
    INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status, password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
    VALUES (
      gen_random_uuid(), v_tenant_id,
      'local-snackbar@itap.zashx.com', 'snackbar@itap.zashx.com',
      'Snack', 'Owner',
      'TENANT_OWNER', 'ACTIVE',
      '$2a$10$r2cjfaF45ZAYEo.hed2otOivQjLIAhaAOXaYMNNtRCq7C0K5Q58rO',
      FALSE, NOW(), NOW(), NOW(), NOW()
    )
    RETURNING id INTO v_owner_id;
  END IF;

  -- 4. Create staff membership (password: Staff2026!)
  SELECT id INTO v_staff_id FROM memberships WHERE tenant_id = v_tenant_id AND role = 'POS_STAFF' LIMIT 1;
  IF v_staff_id IS NULL THEN
    INSERT INTO memberships (id, tenant_id, user_sub, email, first_name, last_name, role, status, password_hash, must_change_password, activated_at, last_active_at, created_at, updated_at)
    VALUES (
      gen_random_uuid(), v_tenant_id,
      'local-staff@snackbar.demo', 'staff@snackbar.demo',
      'Alex', 'Cashier',
      'POS_STAFF', 'ACTIVE',
      '$2a$10$bGQMcz3wbPD4b0XsGUFqSeCUiWc3hxrC4E65RNRWKTJPyQ0.Z6YEK',
      FALSE, NOW(), NOW(), NOW(), NOW()
    )
    RETURNING id INTO v_staff_id;
  END IF;

  -- 5. Create trial subscription (30 days)
  IF NOT EXISTS (SELECT 1 FROM subscriptions WHERE tenant_id = v_tenant_id) THEN
    INSERT INTO subscriptions (id, tenant_id, plan, status, monthly_price, trial_ends_at, created_at, updated_at)
    VALUES (gen_random_uuid(), v_tenant_id, 'trial', 'TRIAL', 0, NOW() + INTERVAL '30 days', NOW(), NOW());
  END IF;

  -- 6. Create tenant settings (tip_presets is JSONB, not integer[])
  IF NOT EXISTS (SELECT 1 FROM tenant_settings WHERE tenant_id = v_tenant_id) THEN
    INSERT INTO tenant_settings (id, tenant_id, tax_enabled, tax_rate, tax_label, tip_enabled, tip_presets, tip_custom_enabled, customer_display_enabled, show_order_details, kitchen_display_enabled, table_ordering_enabled, appointment_booking_enabled, walk_in_enabled, buffer_time_minutes, brand_name, created_at, updated_at)
    VALUES (
      gen_random_uuid(), v_tenant_id,
      TRUE, 13.0, 'HST',
      FALSE, '[15, 18, 20]'::jsonb, FALSE,
      FALSE, TRUE,
      FALSE,
      FALSE,
      FALSE, FALSE, 0,
      'Snack Bar Co',
      NOW(), NOW()
    );
  END IF;

  -- 7. Create categories
  IF NOT EXISTS (SELECT 1 FROM categories WHERE tenant_id = v_tenant_id) THEN
    INSERT INTO categories (id, tenant_id, name, sort_order, is_active, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, 'Candy', 1, TRUE, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, 'Chips', 2, TRUE, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, 'Chocolate', 3, TRUE, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, 'Cereal', 4, TRUE, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, 'Cookies', 5, TRUE, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, 'Drinks', 6, TRUE, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, 'Theatre Boxes', 7, TRUE, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, 'Sauce', 8, TRUE, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, 'Ramen', 9, TRUE, NOW(), NOW());
  END IF;

  -- Get category IDs
  SELECT id INTO v_cat_candy FROM categories WHERE tenant_id = v_tenant_id AND name = 'Candy';
  SELECT id INTO v_cat_chips FROM categories WHERE tenant_id = v_tenant_id AND name = 'Chips';
  SELECT id INTO v_cat_chocolate FROM categories WHERE tenant_id = v_tenant_id AND name = 'Chocolate';
  SELECT id INTO v_cat_cereal FROM categories WHERE tenant_id = v_tenant_id AND name = 'Cereal';
  SELECT id INTO v_cat_cookies FROM categories WHERE tenant_id = v_tenant_id AND name = 'Cookies';
  SELECT id INTO v_cat_drinks FROM categories WHERE tenant_id = v_tenant_id AND name = 'Drinks';
  SELECT id INTO v_cat_theatre FROM categories WHERE tenant_id = v_tenant_id AND name = 'Theatre Boxes';
  SELECT id INTO v_cat_sauce FROM categories WHERE tenant_id = v_tenant_id AND name = 'Sauce';
  SELECT id INTO v_cat_ramen FROM categories WHERE tenant_id = v_tenant_id AND name = 'Ramen';

  -- 8. Create products (prices in cents) — skip if products already exist
  IF NOT EXISTS (SELECT 1 FROM products WHERE tenant_id = v_tenant_id) THEN

    -- CANDY
    INSERT INTO products (id, tenant_id, category_id, name, base_price, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, v_cat_candy, 'Trolli Peach Rings 150g (Germany)', 599, TRUE, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_candy, 'Nerds Gummy Clusters Cherry Lemonade', 699, TRUE, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_candy, 'Nerds Gummy Clusters Berry Punch Rush', 699, TRUE, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_candy, 'Skittles Squishy Cloudz Fruits (EU) 70g', 499, TRUE, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_candy, 'Skittles Giants Fruits (UK) 116g', 599, TRUE, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_candy, 'Life Savers Blackcurrant Pastilles (AUS)', 299, TRUE, 6, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_candy, 'Haribo Pasta Penne Sour Vegan 160g', 599, TRUE, 7, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_candy, 'Mentos Yogurt', 199, TRUE, 8, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_candy, 'Haribo Sour Fries (Germany) 175g', 595, TRUE, 9, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_candy, 'Haribo Sour Rainbow Vegan 160g', 549, TRUE, 10, NOW(), NOW());

    -- CHIPS
    INSERT INTO products (id, tenant_id, category_id, name, base_price, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, v_cat_chips, 'Pringles Hot Ones Los Calientes Rojo 158g', 699, TRUE, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chips, 'Pringles Turkish Style Kabab (UK) 165g', 799, TRUE, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chips, 'Pringles Japanese Stir Fry (UK) 165g', 799, TRUE, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chips, 'Pringles Sweet & Sticky Wings (UK) 160g', 999, TRUE, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chips, 'Lay''s Stax Barbeque (Vietnam) 100g', 599, TRUE, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chips, 'Lay''s Stax Hot Chili Squid (Vietnam) 100g', 599, TRUE, 6, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chips, 'Pringles Sizzl''n Sour Cream (UK) 180g', 1099, TRUE, 7, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chips, 'Pringles Cheesy Jalapeno (UK) 165g', 799, TRUE, 8, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chips, 'Lay''s Stax Spicy Lobster (Vietnam) 100g', 599, TRUE, 9, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chips, 'Pringles Super Hot Spicy Strips (China)', 499, TRUE, 10, NOW(), NOW());

    -- CHOCOLATE
    INSERT INTO products (id, tenant_id, category_id, name, base_price, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, v_cat_chocolate, 'Kit Kat Chunky Rolo 42g', 299, TRUE, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chocolate, 'KitKat Mystery Flavor (Brazil)', 399, TRUE, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chocolate, 'KitKat Lemon (Brazil)', 399, TRUE, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chocolate, 'KitKat Strawberry 41.5g (Brazil)', 399, TRUE, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chocolate, 'KitKat Churros 41.5g (Brazil)', 399, TRUE, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chocolate, 'M&M''s Peanut Butter & Jelly', 399, TRUE, 6, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chocolate, 'Milka Oreo Sandwich 92g', 399, TRUE, 7, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chocolate, 'Milka Bubbly White 95g', 399, TRUE, 8, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chocolate, 'Milka Strawberry 100g', 399, TRUE, 9, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_chocolate, 'Milka Haselnuss 100g', 399, TRUE, 10, NOW(), NOW());

    -- CEREAL
    INSERT INTO products (id, tenant_id, category_id, name, base_price, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, v_cat_cereal, 'Cinnamon Toast Crunch Loaded 428g', 1299, TRUE, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cereal, 'Cap''n Crunch Cotton Candy 288g', 1099, TRUE, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cereal, 'Fruit Loops Marshmallows (USA)', 1149, TRUE, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cereal, 'Frosted Flakes Strawberry Milkshake', 1299, TRUE, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cereal, 'Nesquik Loaded Cereal 368g', 999, TRUE, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cereal, 'Lucky Charms Rainbow Sprinkles', 1499, TRUE, 6, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cereal, 'Lucky Charms Berry Swirl 309g', 1299, TRUE, 7, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cereal, 'Reese''s Puffs PB Lovers 558g', 1499, TRUE, 8, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cereal, 'Rice Krispies Special Edition 340g', 1299, TRUE, 9, NOW(), NOW());

    -- COOKIES
    INSERT INTO products (id, tenant_id, category_id, name, base_price, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, v_cat_cookies, 'Oreo x Pokemon Strawberry (Indonesia) 119g', 649, TRUE, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cookies, 'Oreo Pikachu Chocolate (Indonesia) 119g', 699, TRUE, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cookies, 'Oreo x Pokemon Special Edition 119g', 649, TRUE, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cookies, 'Oreo x Pokemon Chocolate Creme 119g', 649, TRUE, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cookies, 'Oreo Green Grape & Peach (China) 97g', 399, TRUE, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cookies, 'Oreo Raspberry & Blueberry (China) 97g', 399, TRUE, 6, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cookies, 'Pop Tarts Banana Bread 8pk', 999, TRUE, 7, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cookies, 'Pop Tarts Confetti Cupcake 16pk', 1495, TRUE, 8, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cookies, 'Pop Tarts Confetti Cupcake 8pk', 999, TRUE, 9, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_cookies, 'Pop Tarts Strawberry Milkshake 16pk', 1495, TRUE, 10, NOW(), NOW());

    -- DRINKS
    INSERT INTO products (id, tenant_id, category_id, name, base_price, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, v_cat_drinks, 'Pepsi Raspberry Zero Sugar 330mL', 299, TRUE, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_drinks, '7Up Pink Lemonade Zero Sugar 330mL', 399, TRUE, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_drinks, 'Prime Hydration Strawberry Banana 500mL', 799, TRUE, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_drinks, 'Prime UFC 300 Limited Edition 500mL', 799, TRUE, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_drinks, 'Prime Kevin Durant 500mL', 899, TRUE, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_drinks, 'Chubby Pineapple Sunshine 250mL', 125, TRUE, 6, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_drinks, 'Chubby Cream Soda 250mL', 125, TRUE, 7, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_drinks, 'Chubby Orange Tango 250mL', 125, TRUE, 8, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_drinks, 'Faygo Orange 355mL', 249, TRUE, 9, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_drinks, 'Faygo Grape 355mL', 249, TRUE, 10, NOW(), NOW());

    -- THEATRE BOXES
    INSERT INTO products (id, tenant_id, category_id, name, base_price, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, v_cat_theatre, 'Warheads Sour Berry Mix 99g', 399, TRUE, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_theatre, 'Mike & Ike Red Rageous', 299, TRUE, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_theatre, 'Nerds Rainbow', 399, TRUE, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_theatre, 'Nerds Gummy Clusters Rainbow 85g', 399, TRUE, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_theatre, 'Airheads 6 Assorted Flavour', 299, TRUE, 5, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_theatre, 'Dots Tropical', 399, TRUE, 6, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_theatre, 'Warheads Cubes Sour Sweet & Fruity', 299, TRUE, 7, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_theatre, 'Mike & Ike Originals Fruits', 299, TRUE, 8, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_theatre, 'Dots Sour', 399, TRUE, 9, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_theatre, 'Mike & Ike Mega Mix', 299, TRUE, 10, NOW(), NOW());

    -- SAUCE
    INSERT INTO products (id, tenant_id, category_id, name, base_price, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, v_cat_sauce, 'Heinz Pickled Flavored Ketchup (USA)', 1099, TRUE, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_sauce, 'Heinz Habanero Ketchup (USA)', 1099, FALSE, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_sauce, 'Heinz Chipotle Ketchup (USA)', 1099, TRUE, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_sauce, 'Heinz Jalapeno Ketchup (USA)', 1099, FALSE, 4, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_sauce, 'Chick-Fil-A Sauce 16oz', 1299, FALSE, 5, NOW(), NOW());

    -- RAMEN (all sold out)
    INSERT INTO products (id, tenant_id, category_id, name, base_price, is_available, sort_order, created_at, updated_at) VALUES
      (gen_random_uuid(), v_tenant_id, v_cat_ramen, 'Naruto Ramen Curry Beef 61.5g (China)', 349, FALSE, 1, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_ramen, 'Naruto Ramen Steam Seafood 64g (China)', 349, FALSE, 2, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_ramen, 'Naruto Ramen Slow Fire Veal 61.5g (China)', 349, FALSE, 3, NOW(), NOW()),
      (gen_random_uuid(), v_tenant_id, v_cat_ramen, 'Naruto Ramen Chicken Mushroom 61.5g (China)', 349, FALSE, 4, NOW(), NOW());

  END IF;

  RAISE NOTICE '====================================';
  RAISE NOTICE 'Snack Bar Co setup complete!';
  RAISE NOTICE 'Tenant ID: %', v_tenant_id;
  RAISE NOTICE 'Location ID: %', v_location_id;
  RAISE NOTICE '------------------------------------';
  RAISE NOTICE 'OWNER LOGIN:';
  RAISE NOTICE '  Email: snackbar@itap.zashx.com';
  RAISE NOTICE '  Password: Snack2026!';
  RAISE NOTICE 'STAFF LOGIN:';
  RAISE NOTICE '  Email: staff@snackbar.demo';
  RAISE NOTICE '  Password: Staff2026!';
  RAISE NOTICE '====================================';

END $$;
