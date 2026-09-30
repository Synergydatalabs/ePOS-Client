// GET  /api/supplier/product-categories — list this supplier's categories
// POST /api/supplier/product-categories — create a new category
//
// A supplier's product catalog is organized by their own categories (not
// shared with any merchant's Category table). Cheese suppliers might have
// "Aged", "Fresh", "Blue"; a packaging supplier might have "Boxes", "Bags",
// "Tape". Fully per-supplier.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

    const categories = await prisma.supplierProductCategory.findMany({
      where: { supplierTenantId: auth.tenant.id },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { products: true } } },
    });

    return NextResponse.json({ success: true, categories });
  } catch (error: any) {
    console.error("[SUPPLIER-CATEGORIES] GET error:", error);
    return NextResponse.json({ error: "Failed to load categories" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "Category name is required" }, { status: 400 });
    }

    // Explicit dup check — the schema unique constraint would return a
    // Prisma error, but a clean 409 with a readable message is nicer for
    // the client (avoids parsing P2002 codes on the frontend).
    const existing = await prisma.supplierProductCategory.findFirst({
      where: { supplierTenantId: auth.tenant.id, name },
    });
    if (existing) {
      return NextResponse.json({ error: "A category with this name already exists" }, { status: 409 });
    }

    const category = await prisma.supplierProductCategory.create({
      data: {
        supplierTenantId: auth.tenant.id,
        name,
        description: body.description?.trim() || null,
        sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
      },
    });

    return NextResponse.json({ success: true, category });
  } catch (error: any) {
    console.error("[SUPPLIER-CATEGORIES] POST error:", error);
    return NextResponse.json({ error: "Failed to create category" }, { status: 500 });
  }
}
