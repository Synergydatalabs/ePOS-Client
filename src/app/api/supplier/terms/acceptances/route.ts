// =============================================================================
// GET /api/supplier/terms/acceptances — supplier's T&C acceptance ledger.
//
// Every time a customer clicks "I accept" on a supplier's pay page and pays,
// we write a SupplierTermsAcceptance row with typed name + IP + UA + geo +
// full T&C body snapshot + hash. This endpoint returns that ledger for the
// supplier's own tenant so they can see who accepted what and when — the
// chargeback-defense record they might one day need to produce.
//
// Optional query params:
//   versionId  — filter to a specific T&C version
//   limit      — page size (default 100, max 500)
//   cursor     — for pagination (last acceptance id from previous page)
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import { listTermsAcceptances } from "@/lib/supplier-terms";

export async function GET(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { id: true, businessType: true },
    });
    if (!tenant || tenant.businessType !== "supplier") {
      return NextResponse.json({ error: "Not a supplier tenant" }, { status: 403 });
    }

    const url = new URL(request.url);
    const versionId = url.searchParams.get("versionId") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const cursor = url.searchParams.get("cursor") || undefined;

    const acceptances = await listTermsAcceptances(tenant.id, {
      versionId,
      limit,
      cursor,
    });

    return NextResponse.json({ success: true, acceptances });
  } catch (error: any) {
    console.error("[SUPPLIER-TERMS-ACCEPTANCES] GET error:", error);
    return NextResponse.json({ error: "Failed to load acceptances" }, { status: 500 });
  }
}
