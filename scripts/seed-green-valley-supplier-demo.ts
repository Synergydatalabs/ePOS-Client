/**
 * Green Valley Produce — demo supplier tenant seed
 * -----------------------------------------------------------------------
 * Creates a fully-loaded SUPPLIER tenant iTAP staff can use to demo the
 * end-to-end marketplace flow:
 *   • Supplier tenant (businessType="supplier") + SupplierProfile
 *   • Owner login (bcrypt-hashed local auth) → can log into /supplier
 *   • ~8 catalog products across 3 categories (simple products, no
 *     variants — keeps the demo readable; variants can be added by the
 *     supplier from their own portal later)
 *   • Active SupplierMerchantRelationship with Oreugo (so Oreugo can
 *     immediately see the catalog + place POs)
 *   • Also links to Andy's Pizza + Glow Beauty if those tenants exist
 *
 * After running you can:
 *   1. Log into /partner/login as green-valley → see supplier portal
 *   2. Log into /partner/login as Oreugo → Marketplace → see this
 *      supplier's catalog + place a PO
 *   3. From either side, open the PO detail page → send chat messages
 *   4. Deliver the PO from the supplier side → Oreugo's ingredient
 *      stock ticks up
 *
 * Idempotent: deletes any tenant with slug "green-valley-supplier-demo"
 * first (cascade wipes everything). Run repeatedly.
 *
 * Run:
 *   npx tsx scripts/seed-green-valley-supplier-demo.ts
 *
 * Requires DATABASE_URL to point at the target DB.
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const SLUG = "green-valley-supplier-demo";
const OWNER_EMAIL = "owner@greenvalley-demo.com";
const PASSWORD = "Demo1234!";

// Merchant tenants we'll auto-link this supplier to on setup.
// Prefix match so "oreugo", "oreugo-demo", etc. all catch.
const MERCHANT_SLUG_PREFIXES = ["oreugo", "andys-pizza", "glow-beauty"];

// Small catalog — 3 categories, 8 simple products.
type Product = {
  name: string;
  description: string;
  wholesalePriceCents: number;
  unitLabel: string;
  sku?: string;
  minOrderQty?: number;
};
type Category = { name: string; products: Product[] };

const CATALOG: Category[] = [
  {
    name: "Vegetables",
    products: [
      {
        name: "Fresh Tomatoes — 20 lb case",
        description:
          "Vine-ripened, hothouse-grown. Delivered next-day from our Markham farm.",
        wholesalePriceCents: 3400,
        unitLabel: "20 lb case",
        sku: "TOM-CASE-20",
      },
      {
        name: "Iceberg Lettuce — 24 heads",
        description: "Class A. Ships in insulated crates.",
        wholesalePriceCents: 2100,
        unitLabel: "24-head case",
        sku: "LET-ICE-24",
      },
      {
        name: "Yellow Onions — 50 lb sack",
        description: "Ontario-grown.",
        wholesalePriceCents: 2800,
        unitLabel: "50 lb sack",
        sku: "ONI-YEL-50",
      },
    ],
  },
  {
    name: "Herbs & Aromatics",
    products: [
      {
        name: "Fresh Basil — 12-pack case",
        description: "Aeroponic. 12 clamshells per case.",
        wholesalePriceCents: 2400,
        unitLabel: "12-pack case",
        sku: "HRB-BAS-12",
      },
      {
        name: "Garlic — Peeled, 5 lb tub",
        description: "Ready-to-use peeled garlic cloves.",
        wholesalePriceCents: 3200,
        unitLabel: "5 lb tub",
        sku: "GAR-PEEL-5",
      },
    ],
  },
  {
    name: "Dairy & Cheese",
    products: [
      {
        name: "Mozzarella — Whole Milk, 10 lb loaf",
        description:
          "Low-moisture, part-skim. Perfect for pizza.",
        wholesalePriceCents: 5400,
        unitLabel: "10 lb loaf",
        sku: "MOZ-WM-10",
      },
      {
        name: "Butter — Salted, 1 lb print",
        description: "Ontario dairy.",
        wholesalePriceCents: 480,
        unitLabel: "1 lb print",
        sku: "BUT-SLT-1",
        minOrderQty: 12, // must order a dozen
      },
      {
        name: "Cream — 35% whipping, 1 L",
        description: "Whipping cream.",
        wholesalePriceCents: 620,
        unitLabel: "1 L carton",
        sku: "CRM-35-1L",
        minOrderQty: 6,
      },
    ],
  },
];

async function main() {
  console.log("Seeding Green Valley Produce demo supplier…");

  // 1. Idempotency: nuke any prior instance so re-runs are clean.
  const existing = await prisma.tenant.findUnique({ where: { slug: SLUG } });
  if (existing) {
    console.log(`  Removing existing tenant ${SLUG} (${existing.id})…`);
    await prisma.tenant.delete({ where: { id: existing.id } });
  }

  // 2. Supplier tenant + settings + subscription (validateRequest needs it).
  const tenant = await prisma.tenant.create({
    data: {
      name: "Green Valley Produce",
      slug: SLUG,
      currency: "CAD",
      timezone: "America/Toronto",
      businessType: "supplier",
      authProvider: "local",
    },
  });
  await prisma.tenantSettings.create({
    data: { tenantId: tenant.id, taxEnabled: true, taxRate: 13, taxLabel: "HST" },
  });
  await prisma.subscription.create({
    data: {
      tenantId: tenant.id,
      plan: "standard",
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  // 3. SupplierProfile — what merchants see on the catalog page.
  await prisma.supplierProfile.create({
    data: {
      tenantId: tenant.id,
      legalName: "Green Valley Produce Ltd.",
      displayName: "Green Valley Produce",
      websiteUrl: "https://greenvalley.example.ca",
      contactEmail: OWNER_EMAIL,
      contactPhone: "+1 416 555 0104",
      aboutText:
        "Family-run wholesale produce + dairy supplier serving the GTA since 1998. Next-day delivery on all orders placed before 4pm.",
      warehouseAddress: {
        street: "321 Produce Ave",
        city: "Markham",
        province: "ON",
        postalCode: "L3R 5B4",
        country: "CA",
      },
      categories: ["Produce", "Dairy", "Herbs"],
      minOrderCents: 5000, // $50 min
      defaultLeadDays: 1,
      defaultNetTermsDays: 30,
      currency: "CAD",
      isPublic: true, // discoverable in the public marketplace
      // Enum values: NEW | CATALOG_SETUP | GATEWAY_PENDING | ACTIVE | SUSPENDED.
      // ACTIVE = onboarded, catalog live, ready to receive POs.
      onboardingStatus: "ACTIVE",
    },
  });

  // 4. Owner login.
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await prisma.membership.create({
    data: {
      tenantId: tenant.id,
      userSub: `local-${OWNER_EMAIL}`,
      email: OWNER_EMAIL,
      firstName: "Lisa",
      lastName: "Chen",
      role: "TENANT_OWNER",
      status: "ACTIVE",
      passwordHash,
      mustChangePassword: false,
      activatedAt: new Date(),
    },
  });

  // 5. Catalog — categories + products.
  let productCount = 0;
  for (const [catIdx, cat] of CATALOG.entries()) {
    const category = await prisma.supplierProductCategory.create({
      data: {
        supplierTenantId: tenant.id,
        name: cat.name,
        sortOrder: catIdx,
      },
    });
    for (const [prodIdx, p] of cat.products.entries()) {
      await prisma.supplierProduct.create({
        data: {
          supplierTenantId: tenant.id,
          categoryId: category.id,
          name: p.name,
          description: p.description,
          wholesalePriceCents: p.wholesalePriceCents,
          unitLabel: p.unitLabel,
          sku: p.sku,
          minOrderQty: p.minOrderQty || 1,
          stepQty: 1,
          isActive: true,
          isPublic: true, // needed for public marketplace listing
          sortOrder: prodIdx,
        },
      });
      productCount++;
    }
  }

  // 6. Auto-link to any merchant tenant whose slug starts with one of the
  //    known prefixes — Oreugo, Andy's Pizza, Glow Beauty. Skips supplier
  //    tenants automatically via the businessType filter.
  const merchants = await prisma.tenant.findMany({
    where: {
      businessType: { not: "supplier" },
      OR: MERCHANT_SLUG_PREFIXES.map((p) => ({ slug: { startsWith: p } })),
    },
    select: { id: true, name: true, slug: true },
  });
  for (const m of merchants) {
    await prisma.supplierMerchantRelationship.create({
      data: {
        supplierTenantId: tenant.id,
        merchantTenantId: m.id,
        status: "ACTIVE",
        source: "INVITE",
      },
    });
    console.log(`  Linked to merchant: ${m.name} (${m.slug})`);
  }

  console.log("");
  console.log("✅ Done.");
  console.log("");
  console.log("  Supplier tenant:       Green Valley Produce");
  console.log(`  Slug:                  ${SLUG}`);
  console.log(`  Tenant ID:             ${tenant.id}`);
  console.log(`  Owner login email:     ${OWNER_EMAIL}`);
  console.log(`  Owner login password:  ${PASSWORD}`);
  console.log(`  Catalog:               ${productCount} products`);
  console.log(`  Linked merchants:      ${merchants.length}`);
  console.log("");
  console.log("  → Log into /partner/login with the credentials above to access");
  console.log("    the supplier portal at /supplier. From there you can watch");
  console.log("    incoming POs from Oreugo, chat per-PO, and mark POs shipped.");
  console.log("  → Log into Oreugo separately → Marketplace → you'll see this");
  console.log("    supplier's catalog and can submit a test PO.");
  console.log("");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
