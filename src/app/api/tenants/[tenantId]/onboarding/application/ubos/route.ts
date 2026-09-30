// POST /api/tenants/[tenantId]/onboarding/application/ubos
// Adds a UBO to the current in-flight MerchantApplication. TENANT_OWNER only.
// UI enforces a 10-UBO cap; server enforces it too (belt+suspenders) so an
// automated client can't overflow the wizard.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { kybEncrypt } from "@/lib/kyb-crypto";
import type { UboIdType } from "@prisma/client";

// Hardcoded (not Object.values(Prisma.UboIdType)) to avoid the Phase 1a
// module-scope-enum bug.
const VALID_ID_TYPES: UboIdType[] = ["PASSPORT", "DRIVERS_LICENSE", "NATIONAL_ID"];
const UI_UBO_CAP = 10;
const EDITABLE_STATUSES = new Set<string>(["DRAFT", "INFO_REQUESTED"]);

interface UboBody {
  fullName: string;
  dateOfBirth: string;
  nationality: string; // ISO-3
  residentialAddress: Record<string, string>;
  ownershipPct: number;
  isDirector?: boolean;
  isSignatory?: boolean;
  idType: UboIdType;
  idNumber: string;
  idExpiry?: string | null;
  idIssuingCountry?: string | null;
  sourceOfFunds?: string | null;
  isPep?: boolean;
}

async function requireOwner(request: NextRequest, tenantId: string) {
  const auth = await validateRequest(request, tenantId, "TENANT_OWNER");
  if (!auth.success) return auth as any;
  if (auth.context.membership.role !== "TENANT_OWNER") {
    return {
      success: false as const,
      response: NextResponse.json(
        { error: "Only the tenant owner can edit onboarding UBOs." },
        { status: 403 }
      ),
    };
  }
  return auth;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await requireOwner(request, tenantId);
  if (!auth.success) return auth.response;

  let body: UboBody;
  try {
    body = (await request.json()) as UboBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // --- Validate ---
  if (!body.fullName?.trim()) {
    return NextResponse.json({ error: "Full name is required." }, { status: 400 });
  }
  if (!body.dateOfBirth || Number.isNaN(new Date(body.dateOfBirth).valueOf())) {
    return NextResponse.json({ error: "Valid date of birth is required." }, { status: 400 });
  }
  if (!body.nationality || !/^[A-Z]{3}$/.test(body.nationality)) {
    return NextResponse.json(
      { error: "Nationality must be a 3-letter ISO country code." },
      { status: 400 }
    );
  }
  if (typeof body.ownershipPct !== "number" || body.ownershipPct < 0 || body.ownershipPct > 100) {
    return NextResponse.json(
      { error: "Ownership % must be a number between 0 and 100." },
      { status: 400 }
    );
  }
  if (!VALID_ID_TYPES.includes(body.idType)) {
    return NextResponse.json(
      { error: `idType must be one of: ${VALID_ID_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (!body.idNumber?.trim()) {
    return NextResponse.json({ error: "ID number is required." }, { status: 400 });
  }
  if (body.idIssuingCountry && !/^[A-Z]{3}$/.test(body.idIssuingCountry)) {
    return NextResponse.json(
      { error: "ID issuing country must be a 3-letter ISO code." },
      { status: 400 }
    );
  }

  const app = await prisma.merchantApplication.findFirst({
    where: { tenantId, tenantRole: "MERCHANT" },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (!app) {
    return NextResponse.json({ error: "No application to add UBOs to." }, { status: 404 });
  }
  if (!EDITABLE_STATUSES.has(app.status)) {
    return NextResponse.json(
      { error: `Application is ${app.status} and can't be edited.` },
      { status: 409 }
    );
  }

  const count = await prisma.uboRecord.count({ where: { applicationId: app.id } });
  if (count >= UI_UBO_CAP) {
    return NextResponse.json(
      { error: `UBO cap reached (${UI_UBO_CAP}). Remove one before adding another.` },
      { status: 409 }
    );
  }

  const idNumberEnc = kybEncrypt(body.idNumber.trim());
  if (!idNumberEnc) {
    // kybEncrypt only returns null for empty input, which we already
    // rejected — this is a "should never happen" guard.
    return NextResponse.json({ error: "Failed to encrypt ID number." }, { status: 500 });
  }

  const ubo = await prisma.uboRecord.create({
    data: {
      applicationId: app.id,
      fullName: body.fullName.trim().slice(0, 150),
      dateOfBirth: new Date(body.dateOfBirth),
      nationality: body.nationality.toUpperCase(),
      residentialAddress: body.residentialAddress ?? {},
      ownershipPct: body.ownershipPct,
      isDirector: !!body.isDirector,
      isSignatory: !!body.isSignatory,
      idType: body.idType,
      idNumberEnc,
      idExpiry: body.idExpiry ? new Date(body.idExpiry) : null,
      idIssuingCountry: body.idIssuingCountry?.toUpperCase() || null,
      sourceOfFunds: body.sourceOfFunds?.trim().slice(0, 200) || null,
      isPep: !!body.isPep,
    },
  });

  return NextResponse.json({
    ubo: {
      id: ubo.id,
      fullName: ubo.fullName,
      dateOfBirth: ubo.dateOfBirth,
      nationality: ubo.nationality,
      residentialAddress: ubo.residentialAddress,
      ownershipPct: Number(ubo.ownershipPct),
      isDirector: ubo.isDirector,
      isSignatory: ubo.isSignatory,
      idType: ubo.idType,
      hasIdNumber: !!ubo.idNumberEnc,
      idExpiry: ubo.idExpiry,
      idIssuingCountry: ubo.idIssuingCountry,
      sourceOfFunds: ubo.sourceOfFunds,
      isPep: ubo.isPep,
    },
  });
}
