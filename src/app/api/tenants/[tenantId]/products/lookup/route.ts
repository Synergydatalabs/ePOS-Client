// POST /api/tenants/[tenantId]/products/lookup
//   Body: { code: string }
//   Looks up an active product by barcode (exact) OR SKU (exact,
//   case-insensitive). Returns the product with the same includes that
//   the POS list endpoint uses so the caller can add it to the cart with
//   no follow-up fetch.
//
// This is the fast path for barcode scanning at the till.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const code = String(body?.code || "").trim();
    if (!code) {
      return NextResponse.json({ error: "Code is required" }, { status: 400 });
    }

    // Barcode lookup is the common case (dedicated index) — try that first,
    // then fall back to SKU. `mode: 'insensitive'` on SKU handles operators
    // typing "burg-001" for "BURG-001".
    const product =
      (await prisma.product.findFirst({
        where: { tenantId, barcode: code, isActive: true },
        include: {
          variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
          productModifierGroups: {
            include: {
              modifierGroup: {
                include: {
                  modifiers: { where: { isActive: true } },
                },
              },
            },
          },
          category: { select: { id: true, name: true } },
        },
      })) ||
      (await prisma.product.findFirst({
        where: {
          tenantId,
          sku: { equals: code, mode: "insensitive" },
          isActive: true,
        },
        include: {
          variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
          productModifierGroups: {
            include: {
              modifierGroup: {
                include: {
                  modifiers: { where: { isActive: true } },
                },
              },
            },
          },
          category: { select: { id: true, name: true } },
        },
      }));

    if (!product) {
      return NextResponse.json(
        { success: false, error: "No product matches that code" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, product });
  } catch (error: any) {
    console.error("[products/lookup] error:", error);
    return NextResponse.json(
      { error: error?.message || "Lookup failed" },
      { status: 500 }
    );
  }
}
