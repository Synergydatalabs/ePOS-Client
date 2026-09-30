// GET  /api/supplier/warehouses  — list warehouses for the current supplier
// POST /api/supplier/warehouses  — create a new warehouse
//
// A single-location supplier has one row (marked isDefault). Regional
// distributors add more here. The default warehouse is the fallback for
// any PO the supplier doesn't explicitly route at acknowledgement.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

    const warehouses = await prisma.supplierWarehouse.findMany({
      where: { supplierTenantId: auth.tenant.id },
      orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ success: true, warehouses });
  } catch (error: any) {
    console.error("[SUPPLIER-WAREHOUSES] GET error:", error);
    return NextResponse.json({ error: "Failed to load warehouses" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

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

    if (!name?.trim()) {
      return NextResponse.json({ error: "Warehouse name is required" }, { status: 400 });
    }
    if (!address?.trim()) {
      return NextResponse.json({ error: "Address is required" }, { status: 400 });
    }

    // If this row wants to be default, clear the flag on every other
    // warehouse in a transaction — enforces the "at most one default"
    // invariant even if the partial unique index gets bypassed somehow.
    const warehouse = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.supplierWarehouse.updateMany({
          where: { supplierTenantId: auth.tenant.id, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.supplierWarehouse.create({
        data: {
          supplierTenantId: auth.tenant.id,
          name: name.trim(),
          address: address.trim(),
          city: city?.trim() || null,
          province: province?.trim() || null,
          postalCode: postalCode?.trim() || null,
          country: (country?.trim() || "CA").toUpperCase().slice(0, 2),
          phone: phone?.trim() || null,
          servesRegions: Array.isArray(servesRegions) ? servesRegions : [],
          isDefault: !!isDefault,
          isActive: isActive !== false,
          notes: notes?.trim() || null,
          sortOrder: Number.isFinite(sortOrder) ? Number(sortOrder) : 0,
        },
      });
    });

    return NextResponse.json({ success: true, warehouse });
  } catch (error: any) {
    console.error("[SUPPLIER-WAREHOUSES] POST error:", error);
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "A warehouse with this name already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to create warehouse" }, { status: 500 });
  }
}
