// GET    /api/supplier/warehouses/[warehouseId] — detail
// PUT    /api/supplier/warehouses/[warehouseId] — update
// DELETE /api/supplier/warehouses/[warehouseId] — soft-delete via isActive
//
// The DELETE path is intentionally a soft-delete: a warehouse referenced
// by historical POs should keep its address around for the merchant to
// see. Setting isActive=false hides it from the supplier's "assign to"
// picker. Hard-delete happens only if there are ZERO POs referencing it.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";

async function loadOwned(supplierTenantId: string, warehouseId: string) {
  return prisma.supplierWarehouse.findFirst({
    where: { id: warehouseId, supplierTenantId },
  });
}

// --- GET -------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ warehouseId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { warehouseId } = await params;

    const warehouse = await loadOwned(auth.tenant.id, warehouseId);
    if (!warehouse) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, warehouse });
  } catch (error: any) {
    console.error("[SUPPLIER-WAREHOUSE] GET error:", error);
    return NextResponse.json({ error: "Failed to load warehouse" }, { status: 500 });
  }
}

// --- PUT -------------------------------------------------------------------
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ warehouseId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { warehouseId } = await params;

    const existing = await loadOwned(auth.tenant.id, warehouseId);
    if (!existing) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      name,
      address,
      city,
      province,
      postalCode,
      country,
      phone,
      servesRegions,
      isDefault,
      isActive,
      notes,
      sortOrder,
    } = body;

    const updated = await prisma.$transaction(async (tx) => {
      // If flipping isDefault → true, clear other defaults first.
      if (isDefault === true && !existing.isDefault) {
        await tx.supplierWarehouse.updateMany({
          where: {
            supplierTenantId: auth.tenant.id,
            isDefault: true,
            id: { not: warehouseId },
          },
          data: { isDefault: false },
        });
      }
      // If clearing the default flag on the ONLY default row, warn (but
      // allow — merchant might be in the middle of promoting a new one
      // and the reciprocal PUT hasn't fired yet). Downstream fallback
      // handles the zero-default case by using no warehouse.
      return tx.supplierWarehouse.update({
        where: { id: warehouseId },
        data: {
          ...(name !== undefined && { name: name.trim() }),
          ...(address !== undefined && { address: address.trim() }),
          ...(city !== undefined && { city: city?.trim() || null }),
          ...(province !== undefined && { province: province?.trim() || null }),
          ...(postalCode !== undefined && { postalCode: postalCode?.trim() || null }),
          ...(country !== undefined && {
            country: (country?.trim() || "CA").toUpperCase().slice(0, 2),
          }),
          ...(phone !== undefined && { phone: phone?.trim() || null }),
          ...(servesRegions !== undefined && {
            servesRegions: Array.isArray(servesRegions) ? servesRegions : [],
          }),
          ...(isDefault !== undefined && { isDefault: !!isDefault }),
          ...(isActive !== undefined && { isActive: !!isActive }),
          ...(notes !== undefined && { notes: notes?.trim() || null }),
          ...(sortOrder !== undefined && {
            sortOrder: Number.isFinite(sortOrder) ? Number(sortOrder) : 0,
          }),
        },
      });
    });

    return NextResponse.json({ success: true, warehouse: updated });
  } catch (error: any) {
    console.error("[SUPPLIER-WAREHOUSE] PUT error:", error);
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "A warehouse with this name already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to update warehouse" }, { status: 500 });
  }
}

// --- DELETE ----------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ warehouseId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { warehouseId } = await params;

    const existing = await loadOwned(auth.tenant.id, warehouseId);
    if (!existing) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    // Hard-delete only if no POs reference this warehouse — otherwise
    // soft-delete (deactivate) so the merchant can still see it on the
    // historical PO record.
    const referencing = await prisma.purchaseOrder.count({
      where: { warehouseId },
    });

    if (referencing > 0) {
      await prisma.supplierWarehouse.update({
        where: { id: warehouseId },
        // Clear isDefault too — a deactivated warehouse shouldn't be the
        // fallback. Supplier may want to promote a different one next.
        data: { isActive: false, isDefault: false },
      });
      return NextResponse.json({
        success: true,
        softDeleted: true,
        message: `Deactivated — ${referencing} order${referencing !== 1 ? "s" : ""} reference this warehouse.`,
      });
    }

    await prisma.supplierWarehouse.delete({ where: { id: warehouseId } });
    return NextResponse.json({ success: true, softDeleted: false });
  } catch (error: any) {
    console.error("[SUPPLIER-WAREHOUSE] DELETE error:", error);
    return NextResponse.json({ error: "Failed to delete warehouse" }, { status: 500 });
  }
}
