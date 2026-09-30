import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const zones: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, name, zone_type, description, surcharge_type, surcharge_amount,
              surcharge_label, is_active, boundary, sort_order
       FROM zones
       WHERE tenant_id = $1::uuid
       ORDER BY sort_order ASC, name ASC`,
      tenantId
    );

    const formatted = zones.map((z) => ({
      id: z.id,
      name: z.name,
      type: z.zone_type,
      description: z.description,
      surchargeType: z.surcharge_type,
      surchargeAmount: z.surcharge_amount,
      surchargeLabel: z.surcharge_label,
      isActive: z.is_active,
      boundary: z.boundary,
      sortOrder: z.sort_order,
    }));

    return NextResponse.json({ success: true, zones: formatted });
  } catch (error: any) {
    console.error("[CAB] Zones error:", error);
    return NextResponse.json(
      { error: "Failed to load zones" },
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
    const {
      name,
      type,
      surchargeType = "none",
      surchargeAmount = 0,
      description = null,
    } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 }
      );
    }

    const defaultBoundary = '{"type":"Polygon","coordinates":[]}';

    const created: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO zones (tenant_id, name, zone_type, description, boundary, surcharge_type, surcharge_amount)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id, name, zone_type, description, surcharge_type, surcharge_amount,
                 surcharge_label, is_active, boundary, sort_order`,
      tenantId,
      name,
      type,
      description,
      defaultBoundary,
      surchargeType,
      surchargeAmount
    );

    const z = created[0];

    return NextResponse.json({
      id: z.id,
      name: z.name,
      type: z.zone_type,
      description: z.description,
      surchargeType: z.surcharge_type,
      surchargeAmount: z.surcharge_amount,
      surchargeLabel: z.surcharge_label,
      isActive: z.is_active,
      boundary: z.boundary,
      sortOrder: z.sort_order,
    });
  } catch (error: any) {
    console.error("[CAB] Create zone error:", error);
    return NextResponse.json(
      { error: "Failed to create zone" },
      { status: 500 }
    );
  }
}
