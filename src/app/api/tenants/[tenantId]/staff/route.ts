// GET /api/tenants/[tenantId]/staff — List staff members for tenant

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const members = await prisma.membership.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
      },
    });

    return NextResponse.json({
      success: true,
      staff: members.map((m) => ({
        id: m.id,
        name: [m.firstName, m.lastName].filter(Boolean).join(" ") || null,
        email: m.email,
        phone: null,
        role: m.role,
      })),
    });
  } catch (error: any) {
    console.error("[CAB] Staff list error:", error);
    return NextResponse.json(
      { error: "Failed to load staff" },
      { status: 500 }
    );
  }
}
