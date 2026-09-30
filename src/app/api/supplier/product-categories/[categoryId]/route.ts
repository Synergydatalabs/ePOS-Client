// PUT    /api/supplier/product-categories/[categoryId] — rename / re-order / toggle active
// DELETE /api/supplier/product-categories/[categoryId] — remove (products move to "uncategorized")

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";

// Guard: category MUST belong to the current supplier. Prevents a supplier
// from renaming/deleting another supplier's category via a leaked ID.
async function loadOwnedCategory(supplierTenantId: string, categoryId: string) {
  return prisma.supplierProductCategory.findFirst({
    where: { id: categoryId, supplierTenantId },
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { categoryId } = await params;

    const existing = await loadOwnedCategory(auth.tenant.id, categoryId);
    if (!existing) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      // Dup check only if the name actually changed — case-insensitive would
      // require citext; keeping the exact match for now (matches the unique index).
      if (name !== existing.name) {
        const dup = await prisma.supplierProductCategory.findFirst({
          where: { supplierTenantId: auth.tenant.id, name },
        });
        if (dup) {
          return NextResponse.json({ error: "Another category already uses this name" }, { status: 409 });
        }
      }
      data.name = name;
    }
    if (typeof body.description === "string") data.description = body.description.trim() || null;
    if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;
    if (typeof body.isActive === "boolean") data.isActive = body.isActive;

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }

    const updated = await prisma.supplierProductCategory.update({
      where: { id: categoryId },
      data,
    });

    return NextResponse.json({ success: true, category: updated });
  } catch (error: any) {
    console.error("[SUPPLIER-CATEGORIES] PUT error:", error);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { categoryId } = await params;

    const existing = await loadOwnedCategory(auth.tenant.id, categoryId);
    if (!existing) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    // Schema has ON DELETE SET NULL on supplier_products.category_id, so
    // products just lose their category — they're not deleted. Nice and safe.
    await prisma.supplierProductCategory.delete({ where: { id: categoryId } });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[SUPPLIER-CATEGORIES] DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}
