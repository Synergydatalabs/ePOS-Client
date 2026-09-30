// GET /api/tenants/[tenantId]/cab/drivers — List drivers for tenant
// POST /api/tenants/[tenantId]/cab/drivers — Create driver profile

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // online, offline, on_trip, available

    let statusClause = "";
    const queryParams: any[] = [tenantId];

    if (status === "available") {
      statusClause = ` AND dp.duty_status = 'online' AND dp.is_available = true`;
    } else if (status) {
      statusClause = ` AND dp.duty_status = $2`;
      queryParams.push(status);
    }

    const drivers: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        dp.id,
        m.first_name,
        m.last_name,
        m.email,
        dp.photo_url,
        dp.license_number,
        dp.license_expiry,
        dp.duty_status,
        dp.is_available,
        dp.vehicle_id,
        v.plate_number,
        v.make AS vehicle_make,
        v.model AS vehicle_model,
        dp.rating,
        dp.total_trips,
        dp.acceptance_rate,
        dp.commission_value,
        dp.created_at
      FROM driver_profiles dp
      JOIN memberships m ON dp.membership_id = m.id
      LEFT JOIN vehicles v ON dp.vehicle_id = v.id
      WHERE dp.tenant_id = $1::uuid${statusClause}
      ORDER BY dp.created_at DESC
      `,
      ...queryParams
    );

    return NextResponse.json({
      success: true,
      drivers: drivers.map((d) => ({
        id: d.id,
        name: [d.first_name, d.last_name].filter(Boolean).join(" ") || null,
        phone: null,
        email: d.email,
        photoUrl: d.photo_url,
        licenseNumber: d.license_number,
        licenseExpiry: d.license_expiry,
        status: d.duty_status,
        isAvailable: d.is_available,
        vehicleId: d.vehicle_id,
        vehiclePlate: d.plate_number,
        vehicleModel: d.vehicle_model
          ? `${d.vehicle_make || ""} ${d.vehicle_model}`.trim()
          : null,
        vehicle: d.vehicle_model
          ? `${d.vehicle_make || ""} ${d.vehicle_model}`.trim()
          : null,
        lastLocation: null,
        rating: d.rating ? Number(d.rating) : 0,
        totalTrips: d.total_trips ?? 0,
        acceptanceRate: d.acceptance_rate ? Number(d.acceptance_rate) : null,
        commissionRate: d.commission_value ? Number(d.commission_value) : null,
        createdAt: d.created_at,
      })),
    });
  } catch (error: any) {
    console.error("[CAB] Drivers list error:", error);
    return NextResponse.json(
      { error: "Failed to load drivers" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const body = await request.json();
    const { staffId, licenseNumber, licenseExpiry, vehicleId, commissionRate } =
      body;

    if (!staffId || !licenseNumber || !licenseExpiry) {
      return NextResponse.json(
        {
          error:
            "staffId, licenseNumber, and licenseExpiry are required",
        },
        { status: 400 }
      );
    }

    // Verify membership belongs to this tenant
    const membership: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, first_name, last_name, email
       FROM memberships
       WHERE id = $1::uuid AND tenant_id = $2::uuid`,
      staffId,
      tenantId
    );

    if (!membership.length) {
      return NextResponse.json(
        { error: "Staff member not found in this tenant" },
        { status: 404 }
      );
    }

    // Check if driver profile already exists for this membership
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM driver_profiles
       WHERE membership_id = $1::uuid AND tenant_id = $2::uuid`,
      staffId,
      tenantId
    );

    if (existing.length) {
      return NextResponse.json(
        { error: "Driver profile already exists for this staff member" },
        { status: 409 }
      );
    }

    const driverId = crypto.randomUUID();

    const created: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO driver_profiles (
        id, membership_id, tenant_id, license_number, license_expiry,
        vehicle_id, commission_type, commission_value,
        duty_status, is_available, rating, total_trips, total_earnings,
        acceptance_rate, cancellation_rate, created_at, updated_at
      ) VALUES (
        $1::uuid, $2::uuid, $3::uuid, $4, $5,
        $6::uuid, $7, $8,
        'offline', false, 0, 0, 0,
        0, 0, NOW(), NOW()
      )
      RETURNING *`,
      driverId,
      staffId,
      tenantId,
      licenseNumber,
      licenseExpiry,
      vehicleId || null,
      commissionRate != null ? "percentage" : null,
      commissionRate != null ? commissionRate : null
    );

    const d = created[0];
    const m = membership[0];

    return NextResponse.json(
      {
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
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[CAB] Create driver error:", error);
    return NextResponse.json(
      { error: "Failed to create driver" },
      { status: 500 }
    );
  }
}
