// PUT /api/tenants/[tenantId]/cab/drivers/[driverId] — Update driver profile

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; driverId: string }> }
) {
  try {
    const { tenantId, driverId } = await params;
    const body = await request.json();
    const { licenseNumber, licenseExpiry, vehicleId, commissionRate } = body;

    // Build SET clauses dynamically with parameterized values
    const setClauses: string[] = ["updated_at = NOW()"];
    const queryParams: any[] = [driverId, tenantId];
    let paramIndex = 3;

    if (licenseNumber !== undefined) {
      setClauses.push(`license_number = $${paramIndex}`);
      queryParams.push(licenseNumber);
      paramIndex++;
    }

    if (licenseExpiry !== undefined) {
      setClauses.push(`license_expiry = $${paramIndex}`);
      queryParams.push(licenseExpiry);
      paramIndex++;
    }

    if (vehicleId !== undefined) {
      setClauses.push(`vehicle_id = $${paramIndex}::uuid`);
      queryParams.push(vehicleId);
      paramIndex++;
    }

    if (commissionRate !== undefined) {
      setClauses.push(`commission_value = $${paramIndex}`);
      queryParams.push(commissionRate);
      paramIndex++;
      setClauses.push(`commission_type = $${paramIndex}`);
      queryParams.push(commissionRate != null ? "percentage" : null);
      paramIndex++;
    }

    if (setClauses.length === 1) {
      return NextResponse.json(
        { error: "No updates provided" },
        { status: 400 }
      );
    }

    const updated: any[] = await prisma.$queryRawUnsafe(
      `UPDATE driver_profiles
       SET ${setClauses.join(", ")}
       WHERE id = $1::uuid AND tenant_id = $2::uuid
       RETURNING *`,
      ...queryParams
    );

    if (!updated.length) {
      return NextResponse.json(
        { error: "Driver not found" },
        { status: 404 }
      );
    }

    const d = updated[0];

    // Fetch associated membership for name/email
    const membership: any[] = await prisma.$queryRawUnsafe(
      `SELECT first_name, last_name, email
       FROM memberships WHERE id = $1::uuid`,
      d.membership_id
    );

    const m = membership[0] || {};

    return NextResponse.json({
      success: true,
      driver: {
        id: d.id,
        name: [m.first_name, m.last_name].filter(Boolean).join(" ") || null,
        phone: null,
        email: m.email,
        licenseNumber: d.license_number,
        licenseExpiry: d.license_expiry,
        status: d.duty_status,
        vehicleId: d.vehicle_id,
        commissionRate: d.commission_value ? Number(d.commission_value) : null,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
      },
    });
  } catch (error: any) {
    console.error("[CAB] Update driver error:", error);
    return NextResponse.json(
      { error: "Failed to update driver" },
      { status: 500 }
    );
  }
}
