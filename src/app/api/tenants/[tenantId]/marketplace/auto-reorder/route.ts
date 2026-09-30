// POST /api/tenants/[tenantId]/marketplace/auto-reorder
//
// Manually kick off the auto-reorder scanner for this tenant. Same code
// path as the sale-triggered auto-reorder, just called on demand.
// Merchant sees a summary of what was scanned / eligible / drafted so
// they can spot misconfigured ingredients (e.g. "skipped because
// preferred product is no longer active").
//
// GET returns the same shape but with a dry-run: scan + eligibility
// evaluation but no POs written. Handy for "what WOULD happen right now"
// before flipping the master switch on the first time.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import { scanAndReorderForTenant } from "@/lib/marketplace-auto-reorder";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const result = await scanAndReorderForTenant(tenantId);
    return NextResponse.json({ success: true, result });
  } catch (error: any) {
    console.error("[AUTO-REORDER-API] error:", error);
    return NextResponse.json(
      { error: "Failed to run auto-reorder" },
      { status: 500 }
    );
  }
}
