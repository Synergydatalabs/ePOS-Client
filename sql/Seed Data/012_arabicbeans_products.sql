-- =============================================
-- ArabicBeans - Coffee Shop & Restaurant Demo Data
-- Tenant: d0000000-de10-4000-a001-000000000001
-- Location: d0000000-de10-4000-c001-000000000001
-- Run AFTER 010_unified_demo_accounts.sql
-- =============================================

DO $$
DECLARE
    v_tenant_id UUID := 'd0000000-de10-4000-a001-000000000001'::UUID;
    v_location_id UUID := 'd0000000-de10-4000-c001-000000000001'::UUID;

    -- Category IDs
    cat_hot_drinks UUID;
    cat_cold_drinks UUID;
    cat_breakfast UUID;
    cat_pastries UUID;
    cat_sandwiches UUID;
    cat_desserts UUID;
    cat_smoothies UUID;
    cat_sides UUID;

    -- Modifier Group IDs
    mg_milk UUID;
    mg_size UUID;
    mg_shots UUID;
    mg_bread UUID;
    mg_extras UUID;
    mg_toppings UUID;
    mg_eggs UUID;

    -- Supplier IDs
    sup_coffee UUID;
    sup_dairy UUID;
    sup_bakery UUID;
    sup_produce UUID;

    -- Station IDs
    station_bar UUID;
    station_kitchen UUID;
    station_pastry UUID;

BEGIN
    -- =============================================
    -- SUPPLIERS
    -- =============================================
    INSERT INTO suppliers (id, tenant_id, name, contact_name, phone, email, address, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Premium Coffee Roasters', 'Mike Johnson', '+14165550101', 'orders@premiumcoffee.ca', '123 Roaster Lane, Toronto, ON', true, NOW(), NOW()) RETURNING id INTO sup_coffee;
    INSERT INTO suppliers (id, tenant_id, name, contact_name, phone, email, address, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Fresh Dairy Farms', 'Sarah Wilson', '+14165550102', 'supply@freshdairy.ca', '456 Farm Road, Mississauga, ON', true, NOW(), NOW()) RETURNING id INTO sup_dairy;
    INSERT INTO suppliers (id, tenant_id, name, contact_name, phone, email, address, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Artisan Bakery Supplies', 'James Brown', '+14165550103', 'james@artisanbakery.ca', '789 Baker Street, Toronto, ON', true, NOW(), NOW()) RETURNING id INTO sup_bakery;
    INSERT INTO suppliers (id, tenant_id, name, contact_name, phone, email, address, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Green Valley Produce', 'Lisa Chen', '+14165550104', 'orders@greenvalley.ca', '321 Produce Ave, Markham, ON', true, NOW(), NOW()) RETURNING id INTO sup_produce;

    -- =============================================
    -- CATEGORIES
    -- =============================================
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Hot Drinks', 'Espresso, Coffee, Tea & Hot Chocolate', 1, true, NOW(), NOW()) RETURNING id INTO cat_hot_drinks;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Cold Drinks', 'Iced Coffee, Cold Brew & Refreshers', 2, true, NOW(), NOW()) RETURNING id INTO cat_cold_drinks;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Breakfast', 'All-day breakfast items', 3, true, NOW(), NOW()) RETURNING id INTO cat_breakfast;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Pastries & Baked', 'Fresh baked goods daily', 4, true, NOW(), NOW()) RETURNING id INTO cat_pastries;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Sandwiches & Wraps', 'Fresh made sandwiches', 5, true, NOW(), NOW()) RETURNING id INTO cat_sandwiches;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Desserts', 'Cakes, pies & sweet treats', 6, true, NOW(), NOW()) RETURNING id INTO cat_desserts;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Smoothies & Shakes', 'Blended drinks & milkshakes', 7, true, NOW(), NOW()) RETURNING id INTO cat_smoothies;
    INSERT INTO categories (id, tenant_id, name, description, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Sides', 'Extra items and add-ons', 8, true, NOW(), NOW()) RETURNING id INTO cat_sides;

    -- =============================================
    -- MODIFIER GROUPS
    -- =============================================

    -- Milk Options
    INSERT INTO modifier_groups (id, tenant_id, name, display_name, is_required, min_select, max_select, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Milk Choice', 'Choose your milk', false, 0, 1, 1, true, NOW(), NOW()) RETURNING id INTO mg_milk;

    INSERT INTO modifiers (id, group_id, name, price, sort_order, is_default, is_active, created_at) VALUES
        (gen_random_uuid(), mg_milk, 'Regular Milk', 0, 1, true, true, NOW()),
        (gen_random_uuid(), mg_milk, '2% Milk', 0, 2, false, true, NOW()),
        (gen_random_uuid(), mg_milk, 'Skim Milk', 0, 3, false, true, NOW()),
        (gen_random_uuid(), mg_milk, 'Oat Milk', 80, 4, false, true, NOW()),
        (gen_random_uuid(), mg_milk, 'Almond Milk', 80, 5, false, true, NOW()),
        (gen_random_uuid(), mg_milk, 'Soy Milk', 80, 6, false, true, NOW()),
        (gen_random_uuid(), mg_milk, 'Coconut Milk', 80, 7, false, true, NOW());

    -- Size Options
    INSERT INTO modifier_groups (id, tenant_id, name, display_name, is_required, min_select, max_select, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Drink Size', 'Select size', true, 1, 1, 2, true, NOW(), NOW()) RETURNING id INTO mg_size;

    INSERT INTO modifiers (id, group_id, name, price, sort_order, is_default, is_active, created_at) VALUES
        (gen_random_uuid(), mg_size, 'Small (8oz)', 0, 1, true, true, NOW()),
        (gen_random_uuid(), mg_size, 'Medium (12oz)', 100, 2, false, true, NOW()),
        (gen_random_uuid(), mg_size, 'Large (16oz)', 175, 3, false, true, NOW()),
        (gen_random_uuid(), mg_size, 'Extra Large (20oz)', 250, 4, false, true, NOW());

    -- Espresso Shots
    INSERT INTO modifier_groups (id, tenant_id, name, display_name, is_required, min_select, max_select, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Extra Shots', 'Add espresso shots', false, 0, 4, 3, true, NOW(), NOW()) RETURNING id INTO mg_shots;

    INSERT INTO modifiers (id, group_id, name, price, sort_order, is_default, is_active, created_at) VALUES
        (gen_random_uuid(), mg_shots, 'Extra Shot', 85, 1, false, true, NOW()),
        (gen_random_uuid(), mg_shots, 'Double Shot', 150, 2, false, true, NOW()),
        (gen_random_uuid(), mg_shots, 'Triple Shot', 215, 3, false, true, NOW()),
        (gen_random_uuid(), mg_shots, 'Decaf Shot', 85, 4, false, true, NOW());

    -- Bread Options
    INSERT INTO modifier_groups (id, tenant_id, name, display_name, is_required, min_select, max_select, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Bread Choice', 'Choose your bread', true, 1, 1, 4, true, NOW(), NOW()) RETURNING id INTO mg_bread;

    INSERT INTO modifiers (id, group_id, name, price, sort_order, is_default, is_active, created_at) VALUES
        (gen_random_uuid(), mg_bread, 'White Bread', 0, 1, true, true, NOW()),
        (gen_random_uuid(), mg_bread, 'Whole Wheat', 0, 2, false, true, NOW()),
        (gen_random_uuid(), mg_bread, 'Multigrain', 0, 3, false, true, NOW()),
        (gen_random_uuid(), mg_bread, 'Sourdough', 75, 4, false, true, NOW()),
        (gen_random_uuid(), mg_bread, 'Ciabatta', 100, 5, false, true, NOW()),
        (gen_random_uuid(), mg_bread, 'Gluten-Free', 150, 6, false, true, NOW());

    -- Extra Add-ons
    INSERT INTO modifier_groups (id, tenant_id, name, display_name, is_required, min_select, max_select, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Add Extras', 'Customize your order', false, 0, 5, 5, true, NOW(), NOW()) RETURNING id INTO mg_extras;

    INSERT INTO modifiers (id, group_id, name, price, sort_order, is_default, is_active, created_at) VALUES
        (gen_random_uuid(), mg_extras, 'Extra Cheese', 150, 1, false, true, NOW()),
        (gen_random_uuid(), mg_extras, 'Avocado', 200, 2, false, true, NOW()),
        (gen_random_uuid(), mg_extras, 'Bacon', 250, 3, false, true, NOW()),
        (gen_random_uuid(), mg_extras, 'Smoked Salmon', 350, 4, false, true, NOW()),
        (gen_random_uuid(), mg_extras, 'Extra Egg', 150, 5, false, true, NOW());

    -- Toppings
    INSERT INTO modifier_groups (id, tenant_id, name, display_name, is_required, min_select, max_select, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Toppings', 'Add toppings', false, 0, 4, 6, true, NOW(), NOW()) RETURNING id INTO mg_toppings;

    INSERT INTO modifiers (id, group_id, name, price, sort_order, is_default, is_active, created_at) VALUES
        (gen_random_uuid(), mg_toppings, 'Whipped Cream', 75, 1, false, true, NOW()),
        (gen_random_uuid(), mg_toppings, 'Chocolate Drizzle', 50, 2, false, true, NOW()),
        (gen_random_uuid(), mg_toppings, 'Caramel Drizzle', 50, 3, false, true, NOW()),
        (gen_random_uuid(), mg_toppings, 'Vanilla Syrup', 75, 4, false, true, NOW()),
        (gen_random_uuid(), mg_toppings, 'Hazelnut Syrup', 75, 5, false, true, NOW()),
        (gen_random_uuid(), mg_toppings, 'Cinnamon', 0, 6, false, true, NOW());

    -- Egg Style
    INSERT INTO modifier_groups (id, tenant_id, name, display_name, is_required, min_select, max_select, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, 'Egg Style', 'How would you like your eggs?', true, 1, 1, 7, true, NOW(), NOW()) RETURNING id INTO mg_eggs;

    INSERT INTO modifiers (id, group_id, name, price, sort_order, is_default, is_active, created_at) VALUES
        (gen_random_uuid(), mg_eggs, 'Scrambled', 0, 1, true, true, NOW()),
        (gen_random_uuid(), mg_eggs, 'Sunny Side Up', 0, 2, false, true, NOW()),
        (gen_random_uuid(), mg_eggs, 'Over Easy', 0, 3, false, true, NOW()),
        (gen_random_uuid(), mg_eggs, 'Over Medium', 0, 4, false, true, NOW()),
        (gen_random_uuid(), mg_eggs, 'Over Hard', 0, 5, false, true, NOW()),
        (gen_random_uuid(), mg_eggs, 'Poached', 0, 6, false, true, NOW());

    -- =============================================
    -- PRODUCTS - HOT DRINKS
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, is_active, is_available, prep_time_minutes, sort_order, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Espresso', 'Rich and bold single or double shot espresso', 295, 45, true, true, 2, 1, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Americano', 'Espresso with hot water for a smooth coffee', 345, 50, true, true, 2, 2, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Latte', 'Espresso with steamed milk and light foam', 495, 85, true, true, 3, 3, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Cappuccino', 'Equal parts espresso, steamed milk, and foam', 495, 85, true, true, 3, 4, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Flat White', 'Double shot with velvety microfoam milk', 525, 95, true, true, 3, 5, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Mocha', 'Espresso with chocolate and steamed milk', 575, 110, true, true, 4, 6, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Caramel Macchiato', 'Vanilla latte marked with espresso and caramel', 595, 115, true, true, 4, 7, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Hot Chocolate', 'Rich chocolate with steamed milk and whipped cream', 445, 90, true, true, 3, 8, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Chai Latte', 'Spiced chai tea with steamed milk', 495, 95, true, true, 3, 9, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Matcha Latte', 'Premium Japanese matcha with steamed milk', 575, 130, true, true, 3, 10, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'English Breakfast Tea', 'Classic black tea', 295, 25, true, true, 2, 11, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Earl Grey', 'Bergamot-infused black tea', 295, 25, true, true, 2, 12, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Green Tea', 'Light and refreshing green tea', 295, 25, true, true, 2, 13, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_hot_drinks, 'Peppermint Tea', 'Soothing peppermint herbal tea', 295, 25, true, true, 2, 14, NOW(), NOW());

    -- =============================================
    -- PRODUCTS - COLD DRINKS
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, is_active, is_available, prep_time_minutes, sort_order, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Iced Latte', 'Espresso over ice with cold milk', 545, 90, true, true, 2, 1, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Iced Americano', 'Espresso over ice with cold water', 395, 55, true, true, 2, 2, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Cold Brew', '20-hour steeped smooth cold coffee', 495, 75, true, true, 1, 3, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Nitro Cold Brew', 'Creamy nitrogen-infused cold brew', 595, 95, true, true, 1, 4, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Iced Mocha', 'Chocolate espresso over ice with milk', 625, 115, true, true, 3, 5, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Iced Caramel Macchiato', 'Vanilla iced latte with caramel drizzle', 645, 120, true, true, 3, 6, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Iced Matcha Latte', 'Matcha over ice with milk', 625, 135, true, true, 2, 7, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Iced Chai', 'Spiced chai over ice with milk', 545, 100, true, true, 2, 8, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Lemonade', 'Fresh-squeezed lemonade', 395, 60, true, true, 2, 9, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Iced Tea', 'Refreshing house-made iced tea', 345, 35, true, true, 1, 10, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_cold_drinks, 'Sparkling Water', 'San Pellegrino sparkling mineral water', 295, 85, true, true, 0, 11, NOW(), NOW());

    -- =============================================
    -- PRODUCTS - BREAKFAST
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, is_active, is_available, prep_time_minutes, sort_order, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Full English Breakfast', 'Two eggs, bacon, sausage, beans, toast, grilled tomato, and mushrooms', 1595, 450, true, true, 15, 1, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Eggs Benedict', 'Poached eggs on English muffin with ham and hollandaise', 1395, 380, true, true, 12, 2, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Eggs Florentine', 'Poached eggs on English muffin with spinach and hollandaise', 1395, 350, true, true, 12, 3, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Avocado Toast', 'Smashed avocado on sourdough with poached eggs', 1295, 320, true, true, 8, 4, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Classic Breakfast Sandwich', 'Egg, cheese, and bacon on a toasted English muffin', 795, 220, true, true, 6, 5, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Belgian Waffle', 'Fresh Belgian waffle with maple syrup and butter', 995, 180, true, true, 8, 6, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'French Toast', 'Thick-cut brioche French toast with berries', 1095, 220, true, true, 10, 7, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Pancake Stack', 'Three fluffy buttermilk pancakes with maple syrup', 995, 150, true, true, 10, 8, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Granola Bowl', 'House granola with Greek yogurt, honey, and fresh berries', 895, 200, true, true, 3, 9, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Oatmeal', 'Steel-cut oats with brown sugar, cinnamon, and fresh fruit', 695, 120, true, true, 5, 10, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Smoked Salmon Bagel', 'Toasted bagel with cream cheese, smoked salmon, capers, and red onion', 1495, 420, true, true, 5, 11, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_breakfast, 'Two Eggs Any Style', 'Two eggs cooked to order with toast and hash browns', 895, 180, true, true, 8, 12, NOW(), NOW());

    -- =============================================
    -- PRODUCTS - PASTRIES
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, is_active, is_available, prep_time_minutes, sort_order, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Butter Croissant', 'Flaky, buttery French croissant', 395, 85, true, true, 0, 1, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Chocolate Croissant', 'Croissant filled with rich dark chocolate', 445, 95, true, true, 0, 2, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Almond Croissant', 'Croissant filled with almond cream and topped with sliced almonds', 495, 110, true, true, 0, 3, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Blueberry Muffin', 'Fresh-baked muffin loaded with blueberries', 375, 65, true, true, 0, 4, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Chocolate Chip Muffin', 'Classic muffin with chocolate chips', 375, 65, true, true, 0, 5, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Banana Nut Muffin', 'Banana muffin with walnuts', 375, 70, true, true, 0, 6, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Cinnamon Roll', 'Warm cinnamon roll with cream cheese frosting', 495, 90, true, true, 2, 7, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Danish Pastry', 'Fruit-topped Danish with vanilla custard', 445, 85, true, true, 0, 8, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Scone', 'Fresh-baked scone (plain, blueberry, or cranberry orange)', 375, 60, true, true, 0, 9, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Bagel with Cream Cheese', 'Toasted bagel with cream cheese', 445, 80, true, true, 2, 10, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Toast', 'Two slices of toast with butter and jam', 295, 35, true, true, 2, 11, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_pastries, 'Banana Bread', 'Homemade banana bread slice', 395, 65, true, true, 0, 12, NOW(), NOW());

    -- =============================================
    -- PRODUCTS - SANDWICHES
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, is_active, is_available, prep_time_minutes, sort_order, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_sandwiches, 'Turkey Club', 'Roasted turkey, bacon, lettuce, tomato, and mayo on toasted bread', 1295, 380, true, true, 8, 1, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sandwiches, 'Grilled Chicken Panini', 'Grilled chicken with pesto, mozzarella, and roasted peppers', 1395, 400, true, true, 10, 2, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sandwiches, 'Caprese Sandwich', 'Fresh mozzarella, tomato, basil, and balsamic on ciabatta', 1095, 320, true, true, 5, 3, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sandwiches, 'BLT', 'Crispy bacon, lettuce, and tomato on toasted bread', 995, 280, true, true, 6, 4, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sandwiches, 'Ham and Cheese', 'Sliced ham with Swiss cheese on your choice of bread', 995, 270, true, true, 5, 5, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sandwiches, 'Tuna Melt', 'House tuna salad with melted cheddar on toasted bread', 1095, 300, true, true, 7, 6, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sandwiches, 'Veggie Wrap', 'Hummus, cucumber, tomato, mixed greens, and feta in a wrap', 995, 250, true, true, 5, 7, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sandwiches, 'Chicken Caesar Wrap', 'Grilled chicken, romaine, parmesan, and Caesar dressing', 1195, 350, true, true, 6, 8, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sandwiches, 'Grilled Cheese', 'Classic grilled cheese with cheddar on sourdough', 795, 150, true, true, 6, 9, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sandwiches, 'Egg Salad Sandwich', 'Creamy egg salad with lettuce on multigrain', 895, 200, true, true, 5, 10, NOW(), NOW());

    -- =============================================
    -- PRODUCTS - DESSERTS
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, is_active, is_available, prep_time_minutes, sort_order, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_desserts, 'New York Cheesecake', 'Classic creamy cheesecake with graham cracker crust', 695, 180, true, true, 0, 1, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_desserts, 'Chocolate Cake', 'Rich chocolate layer cake with chocolate ganache', 695, 175, true, true, 0, 2, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_desserts, 'Carrot Cake', 'Moist carrot cake with cream cheese frosting', 695, 170, true, true, 0, 3, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_desserts, 'Tiramisu', 'Classic Italian tiramisu with espresso and mascarpone', 795, 200, true, true, 0, 4, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_desserts, 'Apple Pie', 'Warm apple pie with a flaky crust', 595, 140, true, true, 2, 5, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_desserts, 'Brownie', 'Fudgy chocolate brownie', 445, 80, true, true, 0, 6, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_desserts, 'Chocolate Chip Cookie', 'Fresh-baked chocolate chip cookie', 295, 45, true, true, 0, 7, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_desserts, 'Macarons 3pc', 'Assorted French macarons', 595, 150, true, true, 0, 8, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_desserts, 'Gelato', 'Italian gelato - ask for flavors', 545, 120, true, true, 1, 9, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_desserts, 'Affogato', 'Vanilla gelato drowned in hot espresso', 595, 130, true, true, 2, 10, NOW(), NOW());

    -- =============================================
    -- PRODUCTS - SMOOTHIES & SHAKES
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, is_active, is_available, prep_time_minutes, sort_order, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_smoothies, 'Berry Blast Smoothie', 'Mixed berries, banana, yogurt, and honey', 695, 150, true, true, 4, 1, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_smoothies, 'Tropical Paradise', 'Mango, pineapple, coconut milk, and banana', 695, 160, true, true, 4, 2, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_smoothies, 'Green Machine', 'Spinach, banana, apple, and ginger', 745, 170, true, true, 4, 3, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_smoothies, 'Peanut Butter Banana', 'Peanut butter, banana, chocolate, and almond milk', 745, 165, true, true, 4, 4, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_smoothies, 'Acai Bowl', 'Acai blend topped with granola, berries, and coconut', 995, 250, true, true, 5, 5, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_smoothies, 'Chocolate Milkshake', 'Classic chocolate milkshake with whipped cream', 645, 140, true, true, 3, 6, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_smoothies, 'Vanilla Milkshake', 'Classic vanilla milkshake with whipped cream', 645, 130, true, true, 3, 7, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_smoothies, 'Strawberry Milkshake', 'Strawberry milkshake with real strawberries', 645, 140, true, true, 3, 8, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_smoothies, 'Oreo Milkshake', 'Cookies and cream milkshake', 745, 160, true, true, 3, 9, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_smoothies, 'Protein Power', 'Protein powder, banana, peanut butter, and almond milk', 845, 200, true, true, 4, 10, NOW(), NOW());

    -- =============================================
    -- PRODUCTS - SIDES
    -- =============================================
    INSERT INTO products (id, tenant_id, category_id, name, description, base_price, cost_price, is_active, is_available, prep_time_minutes, sort_order, created_at, updated_at) VALUES
        (gen_random_uuid(), v_tenant_id, cat_sides, 'Hash Browns', 'Crispy golden hash browns', 395, 60, true, true, 5, 1, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sides, 'Bacon 3 strips', 'Crispy bacon strips', 445, 100, true, true, 5, 2, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sides, 'Sausage Links 2pc', 'Breakfast sausage links', 445, 90, true, true, 5, 3, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sides, 'Fresh Fruit Cup', 'Seasonal fresh fruit', 495, 120, true, true, 2, 4, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sides, 'Side Salad', 'Mixed greens with balsamic dressing', 495, 80, true, true, 3, 5, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sides, 'Soup of the Day', 'Ask your server for todays selection', 595, 130, true, true, 1, 6, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sides, 'Extra Egg', 'One egg any style', 195, 30, true, true, 3, 7, NOW(), NOW()),
        (gen_random_uuid(), v_tenant_id, cat_sides, 'Extra Toast', 'Two slices of toast', 195, 20, true, true, 2, 8, NOW(), NOW());

    -- =============================================
    -- KITCHEN STATIONS
    -- =============================================
    INSERT INTO kitchen_stations (id, location_id, name, display_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_location_id, 'Barista Bar', 1, true, NOW(), NOW()) RETURNING id INTO station_bar;
    INSERT INTO kitchen_stations (id, location_id, name, display_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_location_id, 'Hot Kitchen', 2, true, NOW(), NOW()) RETURNING id INTO station_kitchen;
    INSERT INTO kitchen_stations (id, location_id, name, display_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_location_id, 'Pastry and Cold', 3, true, NOW(), NOW()) RETURNING id INTO station_pastry;

    -- =============================================
    -- TABLES
    -- =============================================
    INSERT INTO tables (id, location_id, table_number, name, capacity, status, sort_order, is_active, created_at, updated_at) VALUES
        (gen_random_uuid(), v_location_id, '1', 'Window 1', 2, 'AVAILABLE', 1, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, '2', 'Window 2', 2, 'AVAILABLE', 2, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, '3', 'Window 3', 4, 'AVAILABLE', 3, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, '4', 'Center 1', 4, 'AVAILABLE', 4, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, '5', 'Center 2', 4, 'AVAILABLE', 5, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, '6', 'Center 3', 4, 'AVAILABLE', 6, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, '7', 'Booth 1', 6, 'AVAILABLE', 7, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, '8', 'Booth 2', 6, 'AVAILABLE', 8, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, '9', 'Booth 3', 8, 'AVAILABLE', 9, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, '10', 'VIP Room', 10, 'AVAILABLE', 10, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, 'P1', 'Patio 1', 4, 'AVAILABLE', 11, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, 'P2', 'Patio 2', 4, 'AVAILABLE', 12, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, 'P3', 'Patio 3', 6, 'AVAILABLE', 13, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, 'P4', 'Patio 4', 6, 'AVAILABLE', 14, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, 'B1', 'Bar Seat 1', 1, 'AVAILABLE', 15, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, 'B2', 'Bar Seat 2', 1, 'AVAILABLE', 16, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, 'B3', 'Bar Seat 3', 1, 'AVAILABLE', 17, true, NOW(), NOW()),
        (gen_random_uuid(), v_location_id, 'B4', 'Bar Seat 4', 1, 'AVAILABLE', 18, true, NOW(), NOW());

    RAISE NOTICE 'ArabicBeans seed data inserted successfully!';
    RAISE NOTICE 'Categories: 8, Products: 77, Modifier Groups: 7, Modifiers: 40';
    RAISE NOTICE 'Suppliers: 4, Tables: 18, Kitchen Stations: 3';

END $$;
