-- =====================================================================
-- Andy's Pizza demo tenant — pure SQL seed
-- Date: 2026-07-29
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Alternative to seed-andys-pizza-demo.ts for admins who prefer to run
-- SQL directly via psql. Uses pgcrypto's crypt() + gen_salt('bf', 10)
-- to produce bcrypt-compatible hashes that bcryptjs.compare() verifies
-- in the app's local-auth path.
--
-- Idempotent: deletes any prior tenant with slug 'andys-pizza-demo'
-- (cascade wipes everything owned by that tenant) then rebuilds.
--
-- HOW TO APPLY:
--   psql -h <aurora-host> -U <user> -d itap_pos_dev -f seed-andys-pizza-demo.sql
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Wipe prior demo — cascades to memberships / locations / products / etc.
DELETE FROM tenants WHERE slug = 'andys-pizza-demo';

DO $$
DECLARE
  v_tenant_id            UUID;
  v_location_id          UUID;
  v_cat_favourites_id    UUID;
  v_cat_build_id         UUID;
  v_cat_subs_id          UUID;
  v_cat_wings_id         UUID;
  v_cat_extras_id        UUID;
  v_cat_drinks_id        UUID;
  v_mg_toppings_small_id UUID;
  v_mg_toppings_med_id   UUID;
  v_mg_toppings_large_id UUID;
  v_mg_toppings_party_id UUID;
  v_mg_wing_sauces_id    UUID;
  v_password_hash        TEXT;
  v_product_id           UUID;
  v_row                  RECORD;
  v_regular_toppings TEXT[] := ARRAY[
    'Pepperoni','Bacon','Sausage','Beef','Ham','Salami','Anchovies',
    'Green Olives','Hot Peppers','Green Peppers','Mushrooms','Onions',
    'Fresh Tomato','Pineapple','Black Olives','Roasted Red Peppers',
    'Jalapenos','Feta'
  ];
  v_special_toppings TEXT[] := ARRAY['Shrimp','Chicken','Extra Cheese'];
  v_wing_sauces TEXT[] := ARRAY[
    'Honey Garlic','Barbecue','Sweet Chili Thai','Mild','Medium',
    'Dry Cajun','Hot'
  ];
BEGIN
  -- One bcrypt hash reused for both demo logins (Demo1234!).
  v_password_hash := crypt('Demo1234!', gen_salt('bf', 10));

  -- Tenant
  --
  -- Prisma's `@updatedAt` fields are enforced client-side (Prisma auto-
  -- fills them). The DB column is NOT NULL with no default, so raw
  -- SQL inserts must set `updated_at` explicitly. Same for every
  -- `@updatedAt` field in this script (locations, memberships, etc.).
  -- auth_provider MUST be 'local' so the partner-login endpoint's
  -- tenant filter (`authProvider: "local"`) picks up this tenant.
  -- 'partner' looks reasonable but is a different code path that
  -- silently rejects the login credentials.
  INSERT INTO tenants (name, slug, currency, timezone, business_type, auth_provider, updated_at)
  VALUES ('Andy''s Pizza', 'andys-pizza-demo', 'CAD', 'America/Toronto', 'restaurant', 'local', now())
  RETURNING id INTO v_tenant_id;

  -- Settings (tax 13% HST, tips enabled)
  INSERT INTO tenant_settings (
    tenant_id, tax_enabled, tax_rate, tax_label, tip_enabled, tip_presets,
    tip_custom_enabled, receipt_header, receipt_footer, updated_at
  )
  VALUES (
    v_tenant_id, TRUE, 13, 'HST', TRUE, '[15, 18, 20]'::jsonb, TRUE,
    'Andy''s Pizza — Cambridge, ON',
    'Thanks for choosing Andy''s! andyspizzacambridge.ca',
    now()
  );

  -- Location
  INSERT INTO locations (
    tenant_id, name, address, city, province, postal_code, country,
    is_default, public_tour_slug, updated_at
  )
  VALUES (
    v_tenant_id, 'Cambridge Store', '12 Wellington St', 'Cambridge', 'ON',
    'N1R 3Y5', 'CA', TRUE, 'andys-pizza-demo-cambridge', now()
  )
  RETURNING id INTO v_location_id;

  -- Active subscription — required by validateRequest() or logins fail
  INSERT INTO subscriptions (
    tenant_id, plan, status, current_period_start, current_period_end, updated_at
  )
  VALUES (
    v_tenant_id, 'standard', 'ACTIVE',
    now(), now() + interval '1 year', now()
  );

  -- Memberships — bcrypt-hashed passwords via pgcrypto
  INSERT INTO memberships (
    tenant_id, user_sub, email, first_name, last_name, role, status,
    password_hash, must_change_password, activated_at, updated_at
  )
  VALUES
    (v_tenant_id, 'local-owner@andyspizza-demo.com', 'owner@andyspizza-demo.com',
     'Andy', 'Owner', 'TENANT_OWNER', 'ACTIVE',
     v_password_hash, FALSE, now(), now()),
    (v_tenant_id, 'local-staff@andyspizza-demo.com', 'staff@andyspizza-demo.com',
     'Demo', 'Staff', 'POS_STAFF', 'ACTIVE',
     v_password_hash, FALSE, now(), now());

  -- Categories mirroring the real menu sections
  INSERT INTO categories (tenant_id, name, sort_order, updated_at) VALUES
    (v_tenant_id, 'Customer Favourites', 1, now()) RETURNING id INTO v_cat_favourites_id;
  INSERT INTO categories (tenant_id, name, sort_order, updated_at) VALUES
    (v_tenant_id, 'Build Your Own Pizza', 2, now()) RETURNING id INTO v_cat_build_id;
  INSERT INTO categories (tenant_id, name, sort_order, updated_at) VALUES
    (v_tenant_id, 'Subs', 3, now()) RETURNING id INTO v_cat_subs_id;
  INSERT INTO categories (tenant_id, name, sort_order, updated_at) VALUES
    (v_tenant_id, 'Wings', 4, now()) RETURNING id INTO v_cat_wings_id;
  INSERT INTO categories (tenant_id, name, sort_order, updated_at) VALUES
    (v_tenant_id, 'Extras', 5, now()) RETURNING id INTO v_cat_extras_id;
  INSERT INTO categories (tenant_id, name, sort_order, updated_at) VALUES
    (v_tenant_id, 'Drinks', 6, now()) RETURNING id INTO v_cat_drinks_id;

  -- ── Modifier groups: one topping group per size + one wing sauces ─
  -- Small toppings — per-item price $1.25 (250 for specials counted as 2)
  INSERT INTO modifier_groups (tenant_id, name, display_name, is_required, min_select, max_select, updated_at)
  VALUES (v_tenant_id, 'Toppings — Small', 'Choose your toppings', FALSE, 0, 0, now())
  RETURNING id INTO v_mg_toppings_small_id;
  FOR i IN 1..array_length(v_regular_toppings, 1) LOOP
    INSERT INTO modifiers (group_id, name, price, sort_order)
    VALUES (v_mg_toppings_small_id, v_regular_toppings[i], 125, i - 1);
  END LOOP;
  FOR i IN 1..array_length(v_special_toppings, 1) LOOP
    INSERT INTO modifiers (group_id, name, price, sort_order)
    VALUES (v_mg_toppings_small_id, v_special_toppings[i] || ' (counts as 2)', 250,
            array_length(v_regular_toppings, 1) + i - 1);
  END LOOP;

  -- Medium toppings — $1.75 each
  INSERT INTO modifier_groups (tenant_id, name, display_name, is_required, min_select, max_select, updated_at)
  VALUES (v_tenant_id, 'Toppings — Medium', 'Choose your toppings', FALSE, 0, 0, now())
  RETURNING id INTO v_mg_toppings_med_id;
  FOR i IN 1..array_length(v_regular_toppings, 1) LOOP
    INSERT INTO modifiers (group_id, name, price, sort_order)
    VALUES (v_mg_toppings_med_id, v_regular_toppings[i], 175, i - 1);
  END LOOP;
  FOR i IN 1..array_length(v_special_toppings, 1) LOOP
    INSERT INTO modifiers (group_id, name, price, sort_order)
    VALUES (v_mg_toppings_med_id, v_special_toppings[i] || ' (counts as 2)', 350,
            array_length(v_regular_toppings, 1) + i - 1);
  END LOOP;

  -- Large toppings — $2.25 each
  INSERT INTO modifier_groups (tenant_id, name, display_name, is_required, min_select, max_select, updated_at)
  VALUES (v_tenant_id, 'Toppings — Large', 'Choose your toppings', FALSE, 0, 0, now())
  RETURNING id INTO v_mg_toppings_large_id;
  FOR i IN 1..array_length(v_regular_toppings, 1) LOOP
    INSERT INTO modifiers (group_id, name, price, sort_order)
    VALUES (v_mg_toppings_large_id, v_regular_toppings[i], 225, i - 1);
  END LOOP;
  FOR i IN 1..array_length(v_special_toppings, 1) LOOP
    INSERT INTO modifiers (group_id, name, price, sort_order)
    VALUES (v_mg_toppings_large_id, v_special_toppings[i] || ' (counts as 2)', 450,
            array_length(v_regular_toppings, 1) + i - 1);
  END LOOP;

  -- Party toppings — $2.75 each
  INSERT INTO modifier_groups (tenant_id, name, display_name, is_required, min_select, max_select, updated_at)
  VALUES (v_tenant_id, 'Toppings — Party', 'Choose your toppings', FALSE, 0, 0, now())
  RETURNING id INTO v_mg_toppings_party_id;
  FOR i IN 1..array_length(v_regular_toppings, 1) LOOP
    INSERT INTO modifiers (group_id, name, price, sort_order)
    VALUES (v_mg_toppings_party_id, v_regular_toppings[i], 275, i - 1);
  END LOOP;
  FOR i IN 1..array_length(v_special_toppings, 1) LOOP
    INSERT INTO modifiers (group_id, name, price, sort_order)
    VALUES (v_mg_toppings_party_id, v_special_toppings[i] || ' (counts as 2)', 550,
            array_length(v_regular_toppings, 1) + i - 1);
  END LOOP;

  -- Wing sauces — required, min 1 (max 3 = "or mix 'em up")
  INSERT INTO modifier_groups (tenant_id, name, display_name, is_required, min_select, max_select, updated_at)
  VALUES (v_tenant_id, 'Wing Sauces', 'Choose your sauce(s)', TRUE, 1, 3, now())
  RETURNING id INTO v_mg_wing_sauces_id;
  FOR i IN 1..array_length(v_wing_sauces, 1) LOOP
    INSERT INTO modifiers (group_id, name, price, sort_order)
    VALUES (v_mg_wing_sauces_id, v_wing_sauces[i], 0, i - 1);
  END LOOP;

  -- ── Build Your Own Pizza — 4 products (one per size) ────────────
  -- Small
  INSERT INTO products (tenant_id, category_id, name, description, sku, base_price, sort_order, updated_at)
  VALUES (v_tenant_id, v_cat_build_id, 'Build Your Own — Small',
          '6 slice · 11" · cheese + sauce base, add your own toppings',
          'CUSTOM-SMALL', 1260, 0, now())
  RETURNING id INTO v_product_id;
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order)
  VALUES (v_product_id, v_mg_toppings_small_id, 0);

  -- Medium
  INSERT INTO products (tenant_id, category_id, name, description, sku, base_price, sort_order, updated_at)
  VALUES (v_tenant_id, v_cat_build_id, 'Build Your Own — Medium',
          '8 slice · 13" · cheese + sauce base, add your own toppings',
          'CUSTOM-MEDIUM', 1480, 1, now())
  RETURNING id INTO v_product_id;
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order)
  VALUES (v_product_id, v_mg_toppings_med_id, 0);

  -- Large
  INSERT INTO products (tenant_id, category_id, name, description, sku, base_price, sort_order, updated_at)
  VALUES (v_tenant_id, v_cat_build_id, 'Build Your Own — Large',
          '12 slice · 15" · cheese + sauce base, add your own toppings',
          'CUSTOM-LARGE', 1750, 2, now())
  RETURNING id INTO v_product_id;
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order)
  VALUES (v_product_id, v_mg_toppings_large_id, 0);

  -- Party
  INSERT INTO products (tenant_id, category_id, name, description, sku, base_price, sort_order, updated_at)
  VALUES (v_tenant_id, v_cat_build_id, 'Build Your Own — Party',
          '12 slice · 18" · cheese + sauce base, add your own toppings',
          'CUSTOM-PARTY', 2125, 3, now())
  RETURNING id INTO v_product_id;
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order)
  VALUES (v_product_id, v_mg_toppings_party_id, 0);

  -- ── 9 favourite pizzas — one product each with 4 size variants ──
  -- Variant priceAdjustment is the delta from Small (the base_price).
  FOR v_row IN
    SELECT * FROM (VALUES
      ('Pepperoni Pizza',   'Pepperoni',                                                       1455, 1730, 2050, 2465, 0),
      ('Hawaiian Pizza',    'Ham, Pineapple',                                                  1560, 1855, 2175, 2640, 1),
      ('Canadian Pizza',    'Pepperoni, Mushroom, Bacon',                                      1635, 1955, 2255, 2710, 2),
      ('Greek Pizza',       'Black Olives, Feta, Tomato',                                      1635, 1955, 2255, 2710, 3),
      ('Super Deluxe',      'Bacon, Pepperoni, Mushroom, Green Peppers, Onions, Sausage',      1810, 2130, 2475, 2890, 4),
      ('Beev Pizza',        'Pepperoni, Bacon, Green Peppers, Ham, Double Cheese',             1755, 2080, 2385, 2820, 5),
      ('Meat Lovers',       'Pepperoni, Bacon, Sausage, Ham',                                  1700, 2030, 2335, 2765, 6),
      ('Vegetarian Pizza',  'Tomato, Mushroom, Green Peppers',                                 1635, 1955, 2255, 2710, 7),
      ('Cheese Pizza',      'Just cheese & sauce',                                             1260, 1480, 1750, 2125, 8)
    ) AS t(name, description, price_small, price_med, price_large, price_party, sort_order)
  LOOP
    INSERT INTO products (tenant_id, category_id, name, description, base_price, sort_order, updated_at)
    VALUES (v_tenant_id, v_cat_favourites_id, v_row.name, v_row.description,
            v_row.price_small, v_row.sort_order, now())
    RETURNING id INTO v_product_id;

    INSERT INTO product_variants (product_id, name, price_adjustment, sort_order) VALUES
      (v_product_id, 'Small — 6 slice, 11"',  0,                                     0),
      (v_product_id, 'Medium — 8 slice, 13"', v_row.price_med   - v_row.price_small, 1),
      (v_product_id, 'Large — 12 slice, 15"', v_row.price_large - v_row.price_small, 2),
      (v_product_id, 'Party — 12 slice, 18"', v_row.price_party - v_row.price_small, 3);
  END LOOP;

  -- ── 12 subs ──────────────────────────────────────────────────────
  FOR v_row IN
    SELECT * FROM (VALUES
      ('Veggie Sub',     750,  0),
      ('Gyro',           925,  1),
      ('Assorted Sub',   1100, 2),
      ('Ham & Cheese',   1100, 3),
      ('The Italian',    1100, 4),
      ('Roast Beef Sub', 1200, 5),
      ('Corned Beef',    1200, 6),
      ('Pizza Sub',      1200, 7),
      ('Rib Sub',        1200, 8),
      ('Meatball Sub',   1200, 9),
      ('Turkey Sub',     1200, 10),
      ('Super Sub',      1400, 11)
    ) AS t(name, price, sort_order)
  LOOP
    INSERT INTO products (tenant_id, category_id, name, base_price, sort_order, updated_at)
    VALUES (v_tenant_id, v_cat_subs_id, v_row.name, v_row.price, v_row.sort_order, now());
  END LOOP;

  -- ── Wings with sauce modifier ────────────────────────────────────
  INSERT INTO products (tenant_id, category_id, name, description, base_price, sort_order, updated_at)
  VALUES (v_tenant_id, v_cat_wings_id, 'Crispy Wings — 1 lb',
          'One pound of crispy oven-baked wings. Pick your sauce.', 1250, 0, now())
  RETURNING id INTO v_product_id;
  INSERT INTO product_modifier_groups (product_id, modifier_group_id, sort_order)
  VALUES (v_product_id, v_mg_wing_sauces_id, 0);

  -- ── Extras ───────────────────────────────────────────────────────
  FOR v_row IN
    SELECT * FROM (VALUES
      ('Extra Cheese',           75,  0),
      ('Dipping Sauce',          75,  1),
      ('Cheesy Garlic Bread',    700, 2)
    ) AS t(name, price, sort_order)
  LOOP
    INSERT INTO products (tenant_id, category_id, name, base_price, sort_order, updated_at)
    VALUES (v_tenant_id, v_cat_extras_id, v_row.name, v_row.price, v_row.sort_order, now());
  END LOOP;

  -- ── Drinks ───────────────────────────────────────────────────────
  FOR v_row IN
    SELECT * FROM (VALUES
      ('Canned Pop (355ml)',        125, 0),
      ('Bottled Pop (710ml)',       250, 1),
      ('Bottled Juice / Monster',   325, 2)
    ) AS t(name, price, sort_order)
  LOOP
    INSERT INTO products (tenant_id, category_id, name, base_price, sort_order, updated_at)
    VALUES (v_tenant_id, v_cat_drinks_id, v_row.name, v_row.price, v_row.sort_order, now());
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '  ANDY''S PIZZA — DEMO SEEDED';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
  RAISE NOTICE '  Tenant ID:   %', v_tenant_id;
  RAISE NOTICE '  Tenant slug: andys-pizza-demo';
  RAISE NOTICE '  Location:    Cambridge Store, 12 Wellington St';
  RAISE NOTICE '';
  RAISE NOTICE '  OWNER:  owner@andyspizza-demo.com  /  Demo1234!';
  RAISE NOTICE '  STAFF:  staff@andyspizza-demo.com  /  Demo1234!';
  RAISE NOTICE '═══════════════════════════════════════════════════════';
END $$;

COMMIT;
