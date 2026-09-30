import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/cab/promos — List all promo codes
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        id, tenant_id, code, description,
        discount_type, discount_value, max_discount,
        valid_from, valid_until,
        max_uses, max_uses_per_user, current_uses,
        min_fare, first_ride_only,
        ride_types, zones,
        is_active, created_at, updated_at
      FROM promo_codes
      WHERE tenant_id = $1::uuid
      ORDER BY created_at DESC
    `, tenantId);

    const promos = rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      code: r.code,
      description: r.description,
      // Frontend-expected aliases
      type: r.discount_type,
      value: r.discount_value != null ? Number(r.discount_value) : 0,
      maxDiscountCap: r.max_discount != null ? Number(r.max_discount) : null,
      validFrom: r.valid_from,
      validTo: r.valid_until,
      // Also keep canonical names
      discountType: r.discount_type,
      discountValue: r.discount_value != null ? Number(r.discount_value) : 0,
      maxDiscount: r.max_discount != null ? Number(r.max_discount) : null,
      validUntil: r.valid_until,
      maxUses: r.max_uses,
      maxUsesPerUser: r.max_uses_per_user,
      currentUses: r.current_uses ?? 0,
      minFare: r.min_fare != null ? Number(r.min_fare) : null,
      firstRideOnly: r.first_ride_only ?? false,
      rideTypes: r.ride_types,
      zones: r.zones,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    return NextResponse.json({ success: true, promos });
  } catch (error: any) {
    console.error("[CAB] Error listing promos:", error);
    return NextResponse.json(
      { success: false, error: "Failed to list promos" },
      { status: 500 }
    );
  }
}

// POST /api/tenants/[tenantId]/cab/promos — Create a promo code
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();

    const {
      code,
      type,
      value,
      maxDiscountCap,
      minFare,
      validFrom,
      validTo,
      maxUses,
      firstRideOnly,
    } = body;

    if (!code || !type || value === undefined) {
      return NextResponse.json(
        { success: false, error: "code, type, and value are required" },
        { status: 400 }
      );
    }

    const id = crypto.randomUUID();

    const rows: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO promo_codes (
        id, tenant_id, code, discount_type, discount_value,
        max_discount, min_fare,
        valid_from, valid_until,
        max_uses, first_ride_only,
        current_uses, is_active,
        created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3, $4, $5,
        $6, $7,
        $8, $9,
        $10, $11,
        0, true,
        NOW(), NOW()
      )
      RETURNING *
    `,
      id,
      tenantId,
      code.toUpperCase(),
      type,
      value,
      maxDiscountCap ?? null,
      minFare ?? null,
      validFrom ? new Date(validFrom) : null,
      validTo ? new Date(validTo) : null,
      maxUses ?? null,
      firstRideOnly ?? false
    );

    return NextResponse.json({ success: true, promo: rows[0] }, { status: 201 });
  } catch (error: any) {
    console.error("[CAB] Error creating promo:", error);
    return NextResponse.json(
      { success: false, error: "Failed to create promo" },
      { status: 500 }
    );
  }
}
