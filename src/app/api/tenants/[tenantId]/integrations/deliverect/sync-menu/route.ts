// POST /api/tenants/[tenantId]/integrations/deliverect/sync-menu
//   Pushes the tenant's active menu to Deliverect, which propagates to
//   DoorDash / Uber Eats / Skip. Manual for now — an admin clicks
//   "Sync menu" after they change products / prices. Nightly cron is a
//   natural follow-up.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { pushMenu } from "@/lib/deliverect";

type Params = { params: Promise<{ tenantId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const conn = await prisma.integrationConnection.findUnique({
      where: {
        tenantId_provider: { tenantId, provider: "DELIVERECT" },
      },
    });
    if (!conn || conn.status !== "CONNECTED") {
      return NextResponse.json(
        { error: "Deliverect not connected" },
        { status: 400 }
      );
    }
    if (!conn.externalLocationId) {
      return NextResponse.json(
        { error: "externalLocationId not set" },
        { status: 400 }
      );
    }

    try {
      const result = await pushMenu(conn.id);
      return NextResponse.json({ success: result.ok, result });
    } catch (err: any) {
      return NextResponse.json(
        { success: false, error: err?.message || "Menu push failed" },
        { status: 502 }
      );
    }
  } catch (error: any) {
    console.error("[deliverect sync-menu] error:", error);
    return NextResponse.json(
      { error: error?.message || "Sync failed" },
      { status: 500 }
    );
  }
}
