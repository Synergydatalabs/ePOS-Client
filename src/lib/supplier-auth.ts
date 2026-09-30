// Auth helper for supplier-portal endpoints.
//
// Every /api/supplier/* route needs the same three checks:
//   1. Valid partner JWT (getPartnerSession)
//   2. Tenant exists
//   3. Tenant is a supplier (businessType='supplier')
//
// Extracted here so the endpoints stay short and consistent.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";

interface SupplierAuthOk {
  ok: true;
  session: NonNullable<Awaited<ReturnType<typeof getPartnerSession>>>;
  tenant: { id: string; name: string; currency: string; businessType: string };
}

interface SupplierAuthErr {
  ok: false;
  response: NextResponse;
}

export async function requireSupplierAuth(
  request: NextRequest
): Promise<SupplierAuthOk | SupplierAuthErr> {
  const session = await getPartnerSession(request);
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { id: true, name: true, currency: true, businessType: true },
  });
  if (!tenant) {
    return { ok: false, response: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) };
  }
  if (tenant.businessType !== "supplier") {
    return { ok: false, response: NextResponse.json({ error: "Not a supplier tenant" }, { status: 403 }) };
  }

  return {
    ok: true,
    session,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      currency: tenant.currency,
      businessType: tenant.businessType,
    },
  };
}
