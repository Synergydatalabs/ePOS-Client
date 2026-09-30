// GET /api/supplier/statements
// AR aging summary for the current supplier — one row per merchant with
// an outstanding balance, plus grand totals + aging breakdown.

import { NextRequest, NextResponse } from "next/server";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { loadSupplierAging } from "@/lib/marketplace-ar-aging";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

    const data = await loadSupplierAging(auth.tenant.id);
    return NextResponse.json({ success: true, ...data });
  } catch (error: any) {
    console.error("[SUPPLIER-STATEMENTS] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load statements" },
      { status: 500 }
    );
  }
}
