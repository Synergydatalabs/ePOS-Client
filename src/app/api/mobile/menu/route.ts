// GET /api/mobile/menu
//
// Returns everything the mobile POS needs to render the menu screen for the
// logged-in tenant: tenant meta, categories, products.
//
// Kept flat (products carry their categoryId) so the client can regroup as
// needed and the response stays cache-friendly. Prices are in CENTS to
// match Product.basePrice — the client formats.
//
// Only active + available items go over the wire. Out-of-stock or deactivated
// items are filtered at the DB level; the mobile UI never needs to know about
// them.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";

export const dynamic = "force-dynamic";

// Product images are commonly stored as inline base64 data URIs (see
// Product.imageUrl comment in schema.prisma). Shipping multi-KB blobs
// inside every menu payload bloats the response and trips up Coil on
// Android. We rewrite any `data:` imageUrl to the proxy route below —
// backend serves the decoded bytes there, client loads a normal URL.
function proxyImageUrl(origin: string, productId: string, raw: string | null): string | null {
  if (!raw) return null;
  return raw.startsWith("data:")
    ? `${origin}/api/mobile/products/${productId}/image`
    : raw;
}

export async function GET(request: NextRequest) {
  const session = await getPartnerSession(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  const { tenantId } = session;

  const [tenant, categories, products] = await Promise.all([
    prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        currency: true,
        businessType: true,
      },
    }),
    prisma.category.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        sortOrder: true,
        imageUrl: true,
      },
    }),
    prisma.product.findMany({
      where: { tenantId, isActive: true, isAvailable: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        categoryId: true,
        name: true,
        description: true,
        basePrice: true,
        imageUrl: true,
        // A5 (2026-08-18): variants + modifier groups. Both are OPTIONAL
        // per-product — a plain product ships with empty arrays and the
        // client falls through the fast add-to-cart path. Same include
        // shape as the web POS in /api/tenants/[tenantId]/products.
        variants: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            name: true,
            priceAdjustment: true, // Int cents delta over product.basePrice
            sortOrder: true,
          },
        },
        productModifierGroups: {
          orderBy: { sortOrder: "asc" },
          select: {
            modifierGroup: {
              select: {
                id: true,
                name: true,
                displayName: true,
                isRequired: true,
                minSelect: true,
                maxSelect: true, // 0 = unlimited
                sortOrder: true,
                modifiers: {
                  where: { isActive: true },
                  orderBy: { sortOrder: "asc" },
                  select: {
                    id: true,
                    name: true,
                    price: true, // Int cents, per-selection
                    isDefault: true,
                    sortOrder: true,
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  // Derive origin so proxy URLs are absolute — Coil on Android has no
  // notion of "Retrofit base URL" when it fetches an image.
  const origin =
    request.headers.get("origin") ||
    (request.headers.get("host") ? `https://${request.headers.get("host")}` : "") ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "";

  return NextResponse.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      currency: tenant.currency,
      businessType: tenant.businessType,
    },
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      sortOrder: c.sortOrder,
      imageUrl: c.imageUrl,
    })),
    products: products.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      description: p.description,
      basePriceCents: p.basePrice,
      imageUrl: proxyImageUrl(origin, p.id, p.imageUrl),
      variants: p.variants.map((v) => ({
        id: v.id,
        name: v.name,
        priceAdjustmentCents: v.priceAdjustment,
        sortOrder: v.sortOrder,
      })),
      // Flatten the join table so the client just gets modifierGroups directly.
      // Web's join table is a sort-order carrier; we've already ordered by
      // it here, so the flat array preserves the intended presentation order.
      modifierGroups: p.productModifierGroups.map(({ modifierGroup: g }) => ({
        id: g.id,
        name: g.name,
        displayName: g.displayName,
        isRequired: g.isRequired,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        sortOrder: g.sortOrder,
        modifiers: g.modifiers.map((m) => ({
          id: m.id,
          name: m.name,
          priceCents: m.price,
          isDefault: m.isDefault,
          sortOrder: m.sortOrder,
        })),
      })),
    })),
  });
}
