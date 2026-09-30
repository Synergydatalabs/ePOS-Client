// GET /api/supplier/statements/[merchantTenantId]
// Detailed AR statement for ONE merchant this supplier does business with.

import { NextRequest, NextResponse } from "next/server";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { loadMerchantStatement } from "@/lib/marketplace-ar-aging";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ merchantTenantId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { merchantTenantId } = await params;

    const statement = await loadMerchantStatement(auth.tenant.id, merchantTenantId);
    if (!statement) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, statement });
  } catch (error: any) {
    console.error("[SUPPLIER-STATEMENT] GET error:", error);
    return NextResponse.json({ error: "Failed to load statement" }, { status: 500 });
  }
}
