/**
 * Andy's Pizza (Cambridge, ON) — demo tenant seed
 * -----------------------------------------------------------------------
 * Creates a fully-loaded demo tenant iTAP staff can hand to a prospect:
 *   • Tenant + settings (HST 13%, CAD, America/Toronto, restaurant)
 *   • Active subscription so login works
 *   • Location at 12 Wellington St, Cambridge ON N1R 3Y5
 *   • Owner + POS-staff logins (bcrypt-hashed, local password auth)
 *   • 6 categories mirroring the real menu sections
 *   • 9 favourite pizzas × 4 sizes (Small/Medium/Large/Party) as variants
 *   • 4 build-your-own custom pizzas (one per size) with size-priced
 *     topping modifier groups (regular + specials-count-as-2)
 *   • 12 subs, 1 wings item with sauce modifiers, 3 extras, 3 drinks
 *
 * Idempotent: deletes any tenant with slug "andys-pizza-demo" first
 * (cascade wipes everything owned by that tenant). Run repeatedly.
 *
 * Run:
 *   npx tsx scripts/seed-andys-pizza-demo.ts
 *   (or: ts-node scripts/seed-andys-pizza-demo.ts)
 *
 * Requires the tap-app .env DATABASE_URL to point at the target DB.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SLUG = "andys-pizza-demo";
const OWNER_EMAIL = "owner@andyspizza-demo.com";
const STAFF_EMAIL = "staff@andyspizza-demo.com";
const PASSWORD = "Demo1234!";

// ─── Menu data ─────────────────────────────────────────────────────────

// Regular toppings from the "Customise your own pizza!" list.
const REGULAR_TOPPINGS = [
  "Pepperoni", "Bacon", "Sausage", "Beef", "Ham", "Salami",
  "Anchovies", "Green Olives", "Hot Peppers", "Green Peppers", "Mushrooms",
  "Onions", "Fresh Tomato", "Pineapple", "Black Olives",
  "Roasted Red Peppers", "Jalapenos", "Feta",
];

// Menu note: "Shrimp, Chicken, and Extra Cheese count as two items"
// Modeled as separate menu entries priced at 2× the per-topping rate.
const SPECIAL_TOPPINGS = ["Shrimp", "Chicken", "Extra Cheese"];

// Prices from the menu table (cents). base = cheese-only, extra = per-item.
const SIZE_PRICING = {
  Small:  { slices: "6 slice",  inches: '11"', base: 1260, extra: 125 },
  Medium: { slices: "8 slice",  inches: '13"', base: 1480, extra: 175 },
  Large:  { slices: "12 slice", inches: '15"', base: 1750, extra: 225 },
  Party:  { slices: "12 slice", inches: '18"', base: 2125, extra: 275 },
} as const;
type Size = keyof typeof SIZE_PRICING;
const SIZES: Size[] = ["Small", "Medium", "Large", "Party"];

// Customer favourites — prices come straight from the menu table.
// Cheese Pizza uses the cheese-only column; the rest use the item-count row.
const FAVOURITES: Array<{
  name: string;
  desc: string;
  prices: [number, number, number, number]; // Small, Medium, Large, Party
}> = [
  { name: "Pepperoni Pizza",  desc: "Pepperoni",                                 prices: [1455, 1730, 2050, 2465] },
  { name: "Hawaiian Pizza",   desc: "Ham, Pineapple",                             prices: [1560, 1855, 2175, 2640] },
  { name: "Canadian Pizza",   desc: "Pepperoni, Mushroom, Bacon",                 prices: [1635, 1955, 2255, 2710] },
  { name: "Greek Pizza",      desc: "Black Olives, Feta, Tomato",                 prices: [1635, 1955, 2255, 2710] },
  { name: "Super Deluxe",     desc: "Bacon, Pepperoni, Mushroom, Green Peppers, Onions, Sausage", prices: [1810, 2130, 2475, 2890] },
  { name: "Beev Pizza",       desc: "Pepperoni, Bacon, Green Peppers, Ham, Double Cheese",         prices: [1755, 2080, 2385, 2820] },
  { name: "Meat Lovers",      desc: "Pepperoni, Bacon, Sausage, Ham",             prices: [1700, 2030, 2335, 2765] },
  { name: "Vegetarian Pizza", desc: "Tomato, Mushroom, Green Peppers",            prices: [1635, 1955, 2255, 2710] },
  { name: "Cheese Pizza",     desc: "Just cheese & sauce",                        prices: [1260, 1480, 1750, 2125] },
];

const SUBS = [
  { name: "Veggie Sub",    price: 750 },
  { name: "Gyro",          price: 925 },
  { name: "Assorted Sub",  price: 1100 },
  { name: "Ham & Cheese",  price: 1100 },
  { name: "The Italian",   price: 1100 },
  { name: "Roast Beef Sub",price: 1200 },
  { name: "Corned Beef",   price: 1200 },
  { name: "Pizza Sub",     price: 1200 },
  { name: "Rib Sub",       price: 1200 },
  { name: "Meatball Sub",  price: 1200 },
  { name: "Turkey Sub",    price: 1200 },
  { name: "Super Sub",     price: 1400 },
];

const WING_SAUCES = [
  "Honey Garlic", "Barbecue", "Sweet Chili Thai", "Mild",
  "Medium", "Dry Cajun", "Hot",
];

const EXTRAS = [
  { name: "Extra Cheese",        price: 75 },
  { name: "Dipping Sauce",       price: 75 },
  { name: "Cheesy Garlic Bread", price: 700 },
];

const DRINKS = [
  { name: "Canned Pop (355ml)",       price: 125 },
  { name: "Bottled Pop (710ml)",      price: 250 },
  { name: "Bottled Juice / Monster",  price: 325 },
];

// ─── Seed run ──────────────────────────────────────────────────────────

async function main() {
  console.log("🍕  Seeding Andy's Pizza demo tenant...");

  // 1. Wipe any prior demo so re-runs are clean. Cascade drops
  //    memberships / locations / products / everything, EXCEPT three
  //    tables whose Location FK isn't set to CASCADE:
  //      - Order              (line ~1241 in schema.prisma)
  //      - TableSession       (line ~1025)
  //      - KitchenLoadRule    (line ~2279)
  //    These would block Tenant.delete with a P2003 FK violation, so
  //    purge them explicitly first (scoped to this tenant's locations).
  const existing = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (existing) {
    console.log(`   Removing existing tenant (${existing.id})...`);
    const locationIds = (
      await prisma.location.findMany({
        where: { tenantId: existing.id },
        select: { id: true },
      })
    ).map((l) => l.id);
    if (locationIds.length > 0) {
      // Order first — its own children (Payment/OrderItem/KitchenQueue/
      // etc.) cascade from Order.
      await prisma.order.deleteMany({
        where: { locationId: { in: locationIds } },
      });
      await prisma.tableSession.deleteMany({
        where: { locationId: { in: locationIds } },
      });
      await prisma.kitchenLoadRule.deleteMany({
        where: { locationId: { in: locationIds } },
      });
    }
    await prisma.tenant.delete({ where: { id: existing.id } });
  }

  // 2. Tenant + settings
  const tenant = await prisma.tenant.create({
    data: {
      name: "Andy's Pizza",
      slug: SLUG,
      currency: "CAD",
      timezone: "America/Toronto",
      businessType: "restaurant",
      authProvider: "local", // local bcrypt auth — required by /api/partner/auth/login filter
    },
  });

  await prisma.tenantSettings.create({
    data: {
      tenantId: tenant.id,
      taxEnabled: true,
      taxRate: 13,
      taxLabel: "HST",
      tipEnabled: true,
      tipPresets: [15, 18, 20],
      tipCustomEnabled: true,
      receiptHeader: "Andy's Pizza — Cambridge, ON",
      receiptFooter: "Thanks for choosing Andy's! andyspizzacambridge.ca",
    },
  });

  // 3. Location
  const location = await prisma.location.create({
    data: {
      tenantId: tenant.id,
      name: "Cambridge Store",
      address: "12 Wellington St",
      city: "Cambridge",
      province: "ON",
      postalCode: "N1R 3Y5",
      country: "CA",
      isDefault: true,
      publicTourSlug: `${SLUG}-cambridge`,
    },
  });

  // 3b. Default kitchen station — without at least one, orders would
  // still be visible on the Kitchen Display (post-fix, KitchenQueue rows
  // are always created with a nullable stationId), but seeding one gives
  // the demo the proper "grouped by station" experience and shows the
  // station-summary chips at the top.
  await prisma.kitchenStation.create({
    data: {
      locationId: location.id,
      name: "Kitchen",
      displayOrder: 0,
      isActive: true,
    },
  });

  // 4. Subscription — validateRequest() rejects logins without one
  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      plan: "standard",
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  // 5. Memberships — bcrypt-hashed passwords for local auth
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userSub: `local-${OWNER_EMAIL}`,
      email: OWNER_EMAIL,
      firstName: "Andy",
      lastName: "Owner",
      role: "TENANT_OWNER",
      status: "ACTIVE",
      passwordHash,
      mustChangePassword: false,
      activatedAt: new Date(),
    },
  });
  await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userSub: `local-${STAFF_EMAIL}`,
      email: STAFF_EMAIL,
      firstName: "Demo",
      lastName: "Staff",
      role: "POS_STAFF",
      status: "ACTIVE",
      passwordHash,
      mustChangePassword: false,
      activatedAt: new Date(),
    },
  });

  // 6. Categories — mirror the sections on andyspizzacambridge.ca
  const catFavourites = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Customer Favourites", sortOrder: 1 },
  });
  const catBuild = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Build Your Own Pizza", sortOrder: 2 },
  });
  const catSubs = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Subs", sortOrder: 3 },
  });
  const catWings = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Wings", sortOrder: 4 },
  });
  const catExtras = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Extras", sortOrder: 5 },
  });
  const catDrinks = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Drinks", sortOrder: 6 },
  });

  // 7. Modifier groups — one topping group per size (so per-topping prices
  //    can differ per size, matching how the real menu prices toppings).
  const toppingGroupBySize: Record<Size, string> = {} as any;
  for (const size of SIZES) {
    const prices = SIZE_PRICING[size];
    const group = await prisma.modifierGroup.create({
      data: {
        tenantId: tenant.id,
        name: `Toppings — ${size}`,
        displayName: "Choose your toppings",
        isRequired: false,
        minSelect: 0,
        maxSelect: 0, // unlimited
        modifiers: {
          create: [
            ...REGULAR_TOPPINGS.map((n, i) => ({
              name: n,
              price: prices.extra,
              sortOrder: i,
            })),
            ...SPECIAL_TOPPINGS.map((n, i) => ({
              name: `${n} (counts as 2)`,
              price: prices.extra * 2,
              sortOrder: REGULAR_TOPPINGS.length + i,
            })),
          ],
        },
      },
    });
    toppingGroupBySize[size] = group.id;
  }

  // Wing sauces — required, min 1 (menu explicitly says "OR Mix 'em up"
  // so up to 3 pick is fine).
  const wingSaucesGroup = await prisma.modifierGroup.create({
    data: {
      tenantId: tenant.id,
      name: "Wing Sauces",
      displayName: "Choose your sauce(s)",
      isRequired: true,
      minSelect: 1,
      maxSelect: 3,
      modifiers: {
        create: WING_SAUCES.map((n, i) => ({ name: n, price: 0, sortOrder: i })),
      },
    },
  });

  // 8. Build Your Own — 4 separate products (one per size) so the size-
  //    appropriate topping group can be attached. Trade-off: 4 tiles on
  //    the POS instead of 1 with a size picker, but pricing stays exact.
  for (const [i, size] of SIZES.entries()) {
    const prices = SIZE_PRICING[size];
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: catBuild.id,
        name: `Build Your Own — ${size}`,
        description: `${prices.slices} · ${prices.inches} · cheese + sauce base, add your own toppings (each ${(prices.extra / 100).toFixed(2)})`,
        sku: `CUSTOM-${size.toUpperCase()}`,
        basePrice: prices.base,
        sortOrder: i,
        productModifierGroups: {
          create: [
            { modifierGroupId: toppingGroupBySize[size], sortOrder: 0 },
          ],
        },
      },
    });
  }

  // 9. Favourites — one product each with 4 size variants. Variant price
  //    is stored as a delta from the base (Small). Matches the price
  //    table verbatim.
  for (const [i, fav] of FAVOURITES.entries()) {
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: catFavourites.id,
        name: fav.name,
        description: fav.desc,
        basePrice: fav.prices[0], // Small is the "base" price
        sortOrder: i,
        variants: {
          create: SIZES.map((size, si) => {
            const info = SIZE_PRICING[size];
            return {
              name: `${size} — ${info.slices}, ${info.inches}`,
              priceAdjustment: fav.prices[si] - fav.prices[0],
              sortOrder: si,
            };
          }),
        },
      },
    });
  }

  // 10. Subs — flat pricing, no variants or modifiers
  for (const [i, sub] of SUBS.entries()) {
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: catSubs.id,
        name: sub.name,
        basePrice: sub.price,
        sortOrder: i,
      },
    });
  }

  // 11. Wings — one item, sauce required
  await prisma.product.create({
    data: {
      tenantId: tenant.id,
      categoryId: catWings.id,
      name: "Crispy Wings — 1 lb",
      description: "One pound of crispy oven-baked wings. Pick your sauce.",
      basePrice: 1250,
      sortOrder: 0,
      productModifierGroups: {
        create: [{ modifierGroupId: wingSaucesGroup.id, sortOrder: 0 }],
      },
    },
  });

  // 12. Extras + Drinks
  for (const [i, x] of EXTRAS.entries()) {
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: catExtras.id,
        name: x.name,
        basePrice: x.price,
        sortOrder: i,
      },
    });
  }
  for (const [i, d] of DRINKS.entries()) {
    await prisma.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: catDrinks.id,
        name: d.name,
        basePrice: d.price,
        sortOrder: i,
      },
    });
  }

  // ─── Credentials summary ─────────────────────────────────────────────
  console.log("");
  console.log("✅  Seed complete!");
  console.log("");
  console.log("═════════════════════════════════════════════════════════");
  console.log("  ANDY'S PIZZA — DEMO CREDENTIALS");
  console.log("═════════════════════════════════════════════════════════");
  console.log(`  Tenant name:   ${tenant.name}`);
  console.log(`  Tenant slug:   ${tenant.slug}`);
  console.log(`  Tenant ID:     ${tenant.id}`);
  console.log(`  Location:      ${location.name}`);
  console.log(`                 12 Wellington St, Cambridge, ON N1R 3Y5`);
  console.log("");
  console.log("  OWNER (full admin access)");
  console.log(`    Email:       ${OWNER_EMAIL}`);
  console.log(`    Password:    ${PASSWORD}`);
  console.log("");
  console.log("  POS STAFF (till access only)");
  console.log(`    Email:       ${STAFF_EMAIL}`);
  console.log(`    Password:    ${PASSWORD}`);
  console.log("");
  console.log("  MENU LOADED");
  console.log(`    9 favourite pizzas × 4 sizes (36 variant combos)`);
  console.log(`    4 build-your-own pizzas (per-size topping modifiers)`);
  console.log(`    ${SUBS.length} subs · 1 wings item (sauce modifier) · ${EXTRAS.length} extras · ${DRINKS.length} drinks`);
  console.log("═════════════════════════════════════════════════════════");
  console.log("");
  console.log("Send the owner credentials to your prospect. Product");
  console.log("images can be uploaded later via the Menu → Products page.");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
