-- ============================================================
-- ArabicBeans — Ingredients + Stock Levels seed data
-- Tenant:   d0000000-de10-4000-a001-000000000001 (ArabicBeans)
-- Location: d0000000-de10-4000-c001-000000000001 (ArabicBeans Downtown)
-- ============================================================

DO $$
DECLARE
  v_tenant_id UUID := 'd0000000-de10-4000-a001-000000000001';
  v_location_id UUID := 'd0000000-de10-4000-c001-000000000001';

  -- Unit IDs
  v_unit_kg UUID;
  v_unit_g  UUID;
  v_unit_l  UUID;
  v_unit_ml UUID;
  v_unit_pc UUID;

  -- Ingredient IDs
  v_ing_coffee_beans UUID;
  v_ing_milk UUID;
  v_ing_sugar UUID;
  v_ing_tea_leaves UUID;
  v_ing_chocolate UUID;
  v_ing_flour UUID;
  v_ing_butter UUID;
  v_ing_eggs UUID;
  v_ing_vanilla UUID;
  v_ing_cinnamon UUID;
  v_ing_cream UUID;
  v_ing_hazelnut UUID;
  v_ing_caramel UUID;
  v_ing_oat_milk UUID;
  v_ing_almond_milk UUID;
  v_ing_paper_cups UUID;
  v_ing_lids UUID;
  v_ing_napkins UUID;
BEGIN
  -- ============================================================
  -- 1. Units of measure
  -- ============================================================
  INSERT INTO units_of_measure (id, tenant_id, name, symbol, type, base_unit, conversion_factor, is_active)
  VALUES
    (gen_random_uuid(), v_tenant_id, 'Kilogram', 'kg', 'WEIGHT', 'g', 1000, true),
    (gen_random_uuid(), v_tenant_id, 'Gram',     'g',  'WEIGHT', 'g', 1,    true),
    (gen_random_uuid(), v_tenant_id, 'Liter',    'L',  'VOLUME', 'ml', 1000, true),
    (gen_random_uuid(), v_tenant_id, 'Milliliter', 'ml', 'VOLUME', 'ml', 1, true),
    (gen_random_uuid(), v_tenant_id, 'Piece',    'pc', 'COUNT',  'pc', 1,    true)
  ON CONFLICT (tenant_id, symbol) DO NOTHING;

  -- Fetch IDs
  SELECT id INTO v_unit_kg FROM units_of_measure WHERE tenant_id = v_tenant_id AND symbol = 'kg' LIMIT 1;
  SELECT id INTO v_unit_g  FROM units_of_measure WHERE tenant_id = v_tenant_id AND symbol = 'g'  LIMIT 1;
  SELECT id INTO v_unit_l  FROM units_of_measure WHERE tenant_id = v_tenant_id AND symbol = 'L'  LIMIT 1;
  SELECT id INTO v_unit_ml FROM units_of_measure WHERE tenant_id = v_tenant_id AND symbol = 'ml' LIMIT 1;
  SELECT id INTO v_unit_pc FROM units_of_measure WHERE tenant_id = v_tenant_id AND symbol = 'pc' LIMIT 1;

  -- ============================================================
  -- 2. Ingredients
  -- ============================================================
  v_ing_coffee_beans := gen_random_uuid();
  v_ing_milk         := gen_random_uuid();
  v_ing_sugar        := gen_random_uuid();
  v_ing_tea_leaves   := gen_random_uuid();
  v_ing_chocolate    := gen_random_uuid();
  v_ing_flour        := gen_random_uuid();
  v_ing_butter       := gen_random_uuid();
  v_ing_eggs         := gen_random_uuid();
  v_ing_vanilla      := gen_random_uuid();
  v_ing_cinnamon     := gen_random_uuid();
  v_ing_cream        := gen_random_uuid();
  v_ing_hazelnut     := gen_random_uuid();
  v_ing_caramel      := gen_random_uuid();
  v_ing_oat_milk     := gen_random_uuid();
  v_ing_almond_milk  := gen_random_uuid();
  v_ing_paper_cups   := gen_random_uuid();
  v_ing_lids         := gen_random_uuid();
  v_ing_napkins      := gen_random_uuid();

  INSERT INTO ingredients (id, tenant_id, name, description, sku, unit_id, cost_per_unit, low_stock_threshold, is_active, created_at, updated_at) VALUES
    (v_ing_coffee_beans, v_tenant_id, 'Arabica Coffee Beans',   'Premium Colombian arabica', 'ING-001', v_unit_kg, 2500, 2,    true, NOW(), NOW()),
    (v_ing_milk,         v_tenant_id, 'Whole Milk',             'Fresh dairy milk',          'ING-002', v_unit_l,  300,  5,    true, NOW(), NOW()),
    (v_ing_sugar,        v_tenant_id, 'White Sugar',            'Granulated cane sugar',     'ING-003', v_unit_kg, 200,  3,    true, NOW(), NOW()),
    (v_ing_tea_leaves,   v_tenant_id, 'Tea Leaves',             'Loose-leaf black tea',      'ING-004', v_unit_kg, 1800, 1,    true, NOW(), NOW()),
    (v_ing_chocolate,    v_tenant_id, 'Dark Chocolate',         '70% cocoa',                 'ING-005', v_unit_kg, 2200, 1,    true, NOW(), NOW()),
    (v_ing_flour,        v_tenant_id, 'All-Purpose Flour',      'Bleached white flour',      'ING-006', v_unit_kg, 150,  5,    true, NOW(), NOW()),
    (v_ing_butter,       v_tenant_id, 'Unsalted Butter',        'European-style butter',     'ING-007', v_unit_kg, 1200, 2,    true, NOW(), NOW()),
    (v_ing_eggs,         v_tenant_id, 'Large Eggs',             'Grade A large eggs',        'ING-008', v_unit_pc, 40,   24,   true, NOW(), NOW()),
    (v_ing_vanilla,      v_tenant_id, 'Vanilla Extract',        'Pure Madagascar vanilla',   'ING-009', v_unit_ml, 25,   100,  true, NOW(), NOW()),
    (v_ing_cinnamon,     v_tenant_id, 'Ground Cinnamon',        'Ceylon cinnamon',           'ING-010', v_unit_g,  5,    200,  true, NOW(), NOW()),
    (v_ing_cream,        v_tenant_id, 'Heavy Cream',            '35% whipping cream',        'ING-011', v_unit_l,  600,  2,    true, NOW(), NOW()),
    (v_ing_hazelnut,     v_tenant_id, 'Hazelnut Syrup',         'Monin hazelnut flavor',     'ING-012', v_unit_ml, 8,    500,  true, NOW(), NOW()),
    (v_ing_caramel,      v_tenant_id, 'Caramel Syrup',          'Monin caramel flavor',      'ING-013', v_unit_ml, 8,    500,  true, NOW(), NOW()),
    (v_ing_oat_milk,     v_tenant_id, 'Oat Milk',               'Oatly barista',             'ING-014', v_unit_l,  450,  3,    true, NOW(), NOW()),
    (v_ing_almond_milk,  v_tenant_id, 'Almond Milk',            'Unsweetened almond milk',   'ING-015', v_unit_l,  400,  3,    true, NOW(), NOW()),
    (v_ing_paper_cups,   v_tenant_id, '12oz Paper Cups',        'Hot drink cups',            'SUP-001', v_unit_pc, 15,   200,  true, NOW(), NOW()),
    (v_ing_lids,         v_tenant_id, 'Cup Lids',               'Dome lids for cups',        'SUP-002', v_unit_pc, 8,    200,  true, NOW(), NOW()),
    (v_ing_napkins,      v_tenant_id, 'Napkins',                'Paper napkins',             'SUP-003', v_unit_pc, 2,    500,  true, NOW(), NOW())
  ON CONFLICT DO NOTHING;

  -- ============================================================
  -- 3. Location Inventory (stock levels at Downtown location)
  -- Mix: most well-stocked, a couple running low to test alerts
  -- ============================================================
  INSERT INTO location_inventory (id, location_id, ingredient_id, current_stock, last_counted_at, updated_at) VALUES
    (gen_random_uuid(), v_location_id, v_ing_coffee_beans,  15,     NOW(), NOW()),  -- kg
    (gen_random_uuid(), v_location_id, v_ing_milk,          22,     NOW(), NOW()),  -- L
    (gen_random_uuid(), v_location_id, v_ing_sugar,         8,      NOW(), NOW()),  -- kg
    (gen_random_uuid(), v_location_id, v_ing_tea_leaves,    0.8,    NOW(), NOW()),  -- kg — LOW STOCK (threshold 1)
    (gen_random_uuid(), v_location_id, v_ing_chocolate,     3,      NOW(), NOW()),  -- kg
    (gen_random_uuid(), v_location_id, v_ing_flour,         12,     NOW(), NOW()),  -- kg
    (gen_random_uuid(), v_location_id, v_ing_butter,        4,      NOW(), NOW()),  -- kg
    (gen_random_uuid(), v_location_id, v_ing_eggs,          72,     NOW(), NOW()),  -- pieces
    (gen_random_uuid(), v_location_id, v_ing_vanilla,       250,    NOW(), NOW()),  -- ml
    (gen_random_uuid(), v_location_id, v_ing_cinnamon,      150,    NOW(), NOW()),  -- g — LOW STOCK (threshold 200)
    (gen_random_uuid(), v_location_id, v_ing_cream,         6,      NOW(), NOW()),  -- L
    (gen_random_uuid(), v_location_id, v_ing_hazelnut,      1500,   NOW(), NOW()),  -- ml
    (gen_random_uuid(), v_location_id, v_ing_caramel,       1500,   NOW(), NOW()),  -- ml
    (gen_random_uuid(), v_location_id, v_ing_oat_milk,      8,      NOW(), NOW()),  -- L
    (gen_random_uuid(), v_location_id, v_ing_almond_milk,   2,      NOW(), NOW()),  -- L — LOW STOCK (threshold 3)
    (gen_random_uuid(), v_location_id, v_ing_paper_cups,    850,    NOW(), NOW()),  -- pc
    (gen_random_uuid(), v_location_id, v_ing_lids,          150,    NOW(), NOW()),  -- pc — LOW STOCK (threshold 200)
    (gen_random_uuid(), v_location_id, v_ing_napkins,       2500,   NOW(), NOW())   -- pc
  ON CONFLICT (location_id, ingredient_id) DO UPDATE SET
    current_stock = EXCLUDED.current_stock,
    last_counted_at = NOW(),
    updated_at = NOW();

  RAISE NOTICE 'ArabicBeans ingredients + stock seed data loaded successfully!';
  RAISE NOTICE '18 ingredients created (coffee beans, milk, tea, etc.)';
  RAISE NOTICE '18 stock records at location — 4 intentionally low for alert testing';

END $$;
