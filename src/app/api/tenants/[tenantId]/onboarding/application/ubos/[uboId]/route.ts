// PATCH  /api/tenants/[tenantId]/onboarding/application/ubos/[uboId]
// DELETE /api/tenants/[tenantId]/onboarding/application/ubos/[uboId]
//
// TENANT_OWNER only. Only editable while the parent application is in a
// DRAFT / INFO_REQUESTED state.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { kybEncrypt } from "@/lib/kyb-crypto";
import type { UboIdType } from "@prisma/client";

const VALID_ID_TYPES: UboIdType[] = ["PASSPORT", "DRIVERS_LICENSE", "NATIONAL_ID"];
const EDITABLE_STATUSES = new Set<string>(["DRAFT", "INFO_REQUESTED"]);

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

// Fetch the UBO, verify its parent application belongs to the tenant, and
// return both so mutations can inspect application status.
async function findUboWithGuard(uboId: string, tenantId: string) {
  const ubo = await prisma.uboRecord.findUnique({
    where: { id: uboId },
    include: {
      application: {
        select: { id: true, tenantId: true, tenantRole: true, status: true },
      },
    },
  });
  if (!ubo) return null;
  if (ubo.application.tenantId !== tenantId) return null;
  if (ubo.application.tenantRole !== "MERCHANT") return null;
  return ubo;
}

// -----------------------------------------------------------------------------
// PATCH — edit UBO
// -----------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; uboId: string }> }
) {
  const { tenantId, uboId } = await params;
  const auth = await requireOwner(request, tenantId);
  if (!auth.success) return auth.response;

  const ubo = await findUboWithGuard(uboId, tenantId);
  if (!ubo) return NextResponse.json({ error: "UBO not found." }, { status: 404 });
  if (!EDITABLE_STATUSES.has(ubo.application.status)) {
    return NextResponse.json(
      { error: `Application is ${ubo.application.status} and can't be edited.` },
      { status: 409 }
    );
  }

  const body: Partial<{
    fullName: string;
    dateOfBirth: string;
    nationality: string;
    residentialAddress: Record<string, string>;
    ownershipPct: number;
    isDirector: boolean;
    isSignatory: boolean;
    idType: UboIdType;
    idNumber: string; // NEW value; empty string / null leaves prior alone
    idExpiry: string | null;
    idIssuingCountry: string | null;
    sourceOfFunds: string | null;
    isPep: boolean;
  }> = await request.json().catch(() => ({}));

  const data: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);

  if (has("fullName") && body.fullName?.trim()) data.fullName = body.fullName.trim().slice(0, 150);
  if (has("dateOfBirth") && body.dateOfBirth) data.dateOfBirth = new Date(body.dateOfBirth);
  if (has("nationality") && body.nationality) {
    if (!/^[A-Z]{3}$/.test(body.nationality)) {
      return NextResponse.json(
        { error: "Nationality must be a 3-letter ISO country code." },
        { status: 400 }
      );
    }
    data.nationality = body.nationality;
  }
  if (has("residentialAddress")) data.residentialAddress = body.residentialAddress ?? {};
  if (has("ownershipPct")) {
    if (
      typeof body.ownershipPct !== "number" ||
      body.ownershipPct < 0 ||
      body.ownershipPct > 100
    ) {
      return NextResponse.json({ error: "Ownership % must be 0-100." }, { status: 400 });
    }
    data.ownershipPct = body.ownershipPct;
  }
  if (has("isDirector")) data.isDirector = !!body.isDirector;
  if (has("isSignatory")) data.isSignatory = !!body.isSignatory;
  if (has("idType")) {
    if (!body.idType || !VALID_ID_TYPES.includes(body.idType)) {
      return NextResponse.json({ error: "Invalid idType." }, { status: 400 });
    }
    data.idType = body.idType;
  }
  if (has("idNumber") && body.idNumber && body.idNumber.trim()) {
    // Only overwrite the encrypted blob when the owner actually provided
    // a new plaintext value. An empty/whitespace payload is treated as
    // "no change" so the client can safely re-send the whole UBO record
    // without accidentally wiping the ID.
    data.idNumberEnc = kybEncrypt(body.idNumber.trim());
  }
  if (has("idExpiry")) data.idExpiry = body.idExpiry ? new Date(body.idExpiry) : null;
  if (has("idIssuingCountry")) {
    if (body.idIssuingCountry && !/^[A-Z]{3}$/.test(body.idIssuingCountry)) {
      return NextResponse.json(
        { error: "ID issuing country must be a 3-letter ISO code." },
        { status: 400 }
      );
    }
    data.idIssuingCountry = body.idIssuingCountry?.toUpperCase() || null;
  }
  if (has("sourceOfFunds")) data.sourceOfFunds = body.sourceOfFunds?.trim().slice(0, 200) || null;
  if (has("isPep")) data.isPep = !!body.isPep;

  const updated = await prisma.uboRecord.update({
    where: { id: uboId },
    data,
  });

  return NextResponse.json({
    ubo: {
      id: updated.id,
      fullName: updated.fullName,
      dateOfBirth: updated.dateOfBirth,
      nationality: updated.nationality,
      residentialAddress: updated.residentialAddress,
      ownershipPct: Number(updated.ownershipPct),
      isDirector: updated.isDirector,
      isSignatory: updated.isSignatory,
      idType: updated.idType,
      hasIdNumber: !!updated.idNumberEnc,
      idExpiry: updated.idExpiry,
      idIssuingCountry: updated.idIssuingCountry,
      sourceOfFunds: updated.sourceOfFunds,
      isPep: updated.isPep,
    },
  });
}

// -----------------------------------------------------------------------------
// DELETE — remove a UBO
// -----------------------------------------------------------------------------

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; uboId: string }> }
) {
  const { tenantId, uboId } = await params;
  const auth = await requireOwner(request, tenantId);
  if (!auth.success) return auth.response;

  const ubo = await findUboWithGuard(uboId, tenantId);
  if (!ubo) return NextResponse.json({ error: "UBO not found." }, { status: 404 });
  if (!EDITABLE_STATUSES.has(ubo.application.status)) {
    return NextResponse.json(
      { error: `Application is ${ubo.application.status} and can't be edited.` },
      { status: 409 }
    );
  }

  await prisma.uboRecord.delete({ where: { id: uboId } });
  return NextResponse.json({ ok: true });
}
