// GET /api/tenants/[tenantId]/suppliers/[supplierId] - Get supplier
// PUT /api/tenants/[tenantId]/suppliers/[supplierId] - Update supplier
// DELETE /api/tenants/[tenantId]/suppliers/[supplierId] - Delete supplier

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get supplier with ingredients
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; supplierId: string }> }
) {
  try {
    const { tenantId, supplierId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      include: {
        ingredients: {
          include: {
            unit: true,
          },
          orderBy: { name: "asc" },
        },
      },
    });

    if (!supplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      supplier,
    });
  } catch (error: any) {
    console.error("[TAP API] Get supplier error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// PUT - Update supplier
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; supplierId: string }> }
) {
  try {
    const { tenantId, supplierId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { name, contactName, email, phone, address, notes } = body;

    const existing = await prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      );
    }

    const supplier = await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(contactName !== undefined && { contactName: contactName?.trim() || null }),
        ...(email !== undefined && { email: email?.trim() || null }),
        ...(phone !== undefined && { phone: phone?.trim() || null }),
        ...(address !== undefined && { address: address?.trim() || null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
      },
      include: {
        _count: { select: { ingredients: true } },
      },
    });

    console.log(`[TAP API] Updated supplier: ${supplier.name}`);

    return NextResponse.json({
      success: true,
      supplier,
    });
  } catch (error: any) {
    console.error("[TAP API] Update supplier error:", error);
    return NextResponse.json(
      { error: "Failed to update supplier" },
      { status: 500 }
    );
  }
}

// DELETE - Delete supplier
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; supplierId: string }> }
) {
  try {
    const { tenantId, supplierId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      include: {
        _count: { select: { ingredients: true } },
      },
    });

    if (!supplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      );
    }

    // Check if has linked ingredients
    if (supplier._count.ingredients > 0) {
      return NextResponse.json(
        { error: "Cannot delete supplier with linked ingredients. Unlink ingredients first." },
        { status: 409 }
      );
    }

    await prisma.supplier.delete({
      where: { id: supplierId },
    });

    console.log(`[TAP API] Deleted supplier: ${supplier.name}`);

    return NextResponse.json({
      success: true,
      message: "Supplier deleted",
    });
  } catch (error: any) {
    console.error("[TAP API] Delete supplier error:", error);
    return NextResponse.json(
      { error: "Failed to delete supplier" },
      { status: 500 }
    );
  }
}
