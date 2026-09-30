// ============================================================================
// GET   /api/tenants/[tenantId]/onboarding/application
//   Returns the tenant's active MerchantApplication (DRAFT / INFO_REQUESTED /
//   SUBMITTED / IN_REVIEW / ...), including UBOs and documents for wizard
//   hydration. Empty response (`{ application: null }`) when the tenant has
//   never started one — the wizard renders a fresh Step 1 in that case.
//
// POST  /api/tenants/[tenantId]/onboarding/application
//   Creates a new DRAFT for this tenant. Called on first save when no
//   application exists. Rejects if there's already an in-flight one, to
//   keep the queue clean (mirrors the supplier flow's guard).
//
// PATCH /api/tenants/[tenantId]/onboarding/application
//   Updates the DRAFT (or INFO_REQUESTED) row. Body is a partial of the
//   editable fields; unspecified fields are left alone. Encrypts tax id
//   and bank info via kyb-crypto. Any other status = 409.
//
// All routes require TENANT_OWNER — Phase 2c decision to keep intake to
// the owner only; managers see the sidebar link disabled.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { kybEncrypt, kybEncryptJson } from "@/lib/kyb-crypto";

// Editable-in-DRAFT statuses. Kept as a plain array (no Object.values on a
// Prisma enum at module scope — that pattern bit us in Phase 1a).
const EDITABLE_STATUSES = new Set<string>(["DRAFT", "INFO_REQUESTED"]);

// Statuses that count as "in flight" for the one-app-at-a-time guard.
// Note the enum name is `GatewayApplicationStatus` and includes DRAFT,
// SUBMITTED, IN_REVIEW, FORWARDED, INFO_REQUESTED, PROVIDER_APPROVED,
// APPROVED, REJECTED, LIVE.
const INFLIGHT_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "IN_REVIEW",
  "FORWARDED",
  "INFO_REQUESTED",
  "PROVIDER_APPROVED",
  "APPROVED",
] as const;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

// Enforce OWNER-only for the intake wizard. validateRequest already checks
// role LEVEL >= TENANT_OWNER (100), but that admits nobody else since
// TENANT_OWNER is the max — belt+suspenders explicit check keeps intent
// obvious to a future reader.
async function requireOwner(request: NextRequest, tenantId: string) {
  const auth = await validateRequest(request, tenantId, "TENANT_OWNER");
  if (!auth.success) return auth as any;
  if (auth.context.membership.role !== "TENANT_OWNER") {
    return {
      success: false as const,
      response: NextResponse.json(
        { error: "Only the tenant owner can submit an onboarding application." },
        { status: 403 }
      ),
    };
  }
  return auth;
}

// Serialize a MerchantApplication + relations for the wizard client.
// Deliberately DOES NOT decrypt sensitive fields — the wizard just needs
// to know whether they're set, so we return flags and let the user re-enter
// on edit.
function serializeApplication(app: any) {
  return {
    id: app.id,
    status: app.status,
    tenantRole: app.tenantRole,
    targetProcessor: app.targetProcessor,

    legalName: app.legalName,
    dbaName: app.dbaName,
    businessTypeName: app.businessTypeName,
    incorporationDate: app.incorporationDate,
    incorporationRegion: app.incorporationRegion,
    businessAddress: app.businessAddress,
    websiteUrl: app.websiteUrl,
    mccCode: app.mccCode,

    projectedMonthlyVolumeCents: app.projectedMonthlyVolumeCents,
    averageTicketCents: app.averageTicketCents,
    currency: app.currency,

    // Do not send the ciphertext to the client. Flags only.
    hasTaxId: !!app.taxIdEnc,
    hasBankInfo: !!app.bankInfoEnc,

    signerName: app.signerName,
    signerTitle: app.signerTitle,
    signerEmail: app.signerEmail,
    signerConsentedAt: app.signerConsentedAt,

    infoRequested: app.infoRequested,
    rejectionReason: app.rejectionReason,
    submittedAt: app.submittedAt,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,

    ubos: (app.ubos ?? []).map((u: any) => ({
      id: u.id,
      fullName: u.fullName,
      dateOfBirth: u.dateOfBirth,
      nationality: u.nationality,
      residentialAddress: u.residentialAddress,
      ownershipPct: Number(u.ownershipPct),
      isDirector: u.isDirector,
      isSignatory: u.isSignatory,
      idType: u.idType,
      // Same rule as tax id / bank info — the client gets a "was set" flag,
      // never the ciphertext. On edit the owner re-enters the ID number.
      hasIdNumber: !!u.idNumberEnc,
      idExpiry: u.idExpiry,
      idIssuingCountry: u.idIssuingCountry,
      sourceOfFunds: u.sourceOfFunds,
      isPep: u.isPep,
    })),

    documents: (app.documents ?? [])
      .filter((d: any) => !d.deletedAt)
      .map((d: any) => ({
        id: d.id,
        docType: d.docType,
        originalFilename: d.originalFilename,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        sha256: d.sha256,
        scanStatus: d.scanStatus,
        createdAt: d.createdAt,
      })),
  };
}

// -----------------------------------------------------------------------------
// GET
// -----------------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await requireOwner(request, tenantId);
  if (!auth.success) return auth.response;

  // Pick the most recent in-flight MERCHANT application, if any. Kept
  // separate from the SUPPLIER row (a tenant can theoretically be both).
  const application = await prisma.merchantApplication.findFirst({
    where: {
      tenantId,
      tenantRole: "MERCHANT",
      status: { in: [...INFLIGHT_STATUSES] as any },
    },
    orderBy: { createdAt: "desc" },
    include: {
      ubos: { orderBy: { createdAt: "asc" } },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  return NextResponse.json({
    application: application ? serializeApplication(application) : null,
  });
}

// -----------------------------------------------------------------------------
// POST — create a fresh DRAFT
// -----------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await requireOwner(request, tenantId);
  if (!auth.success) return auth.response;

  const inflight = await prisma.merchantApplication.findFirst({
    where: {
      tenantId,
      tenantRole: "MERCHANT",
      status: { in: [...INFLIGHT_STATUSES] as any },
    },
    select: { id: true, status: true },
  });
  if (inflight) {
    return NextResponse.json(
      {
        error: `An application already exists (${inflight.status}). Load it instead of creating a new one.`,
        applicationId: inflight.id,
      },
      { status: 409 }
    );
  }

  const app = await prisma.merchantApplication.create({
    data: {
      tenantId,
      tenantRole: "MERCHANT",
      status: "DRAFT",
      // legalName is NOT NULL in schema — placeholder that the wizard's
      // Step 1 immediately overwrites via PATCH on the first save.
      legalName: "(draft — not yet named)",
      createdByMembershipId: auth.context.membership.id,
    },
    include: {
      ubos: true,
      documents: true,
    },
  });

  // Kick off the audit trail with the DRAFT-creation event so the timeline
  // has a start marker before any admin action.
  await prisma.applicationEvent.create({
    data: {
      applicationId: app.id,
      fromStatus: null,
      toStatus: "DRAFT",
      actorType: "MERCHANT",
      actorId: auth.context.membership.id,
      note: "Draft created by tenant owner.",
    },
  });

  return NextResponse.json({ application: serializeApplication(app) });
}

// -----------------------------------------------------------------------------
// PATCH — update DRAFT / INFO_REQUESTED fields
// -----------------------------------------------------------------------------

interface PatchBody {
  applicationId?: string;

  legalName?: string;
  dbaName?: string | null;
  businessTypeName?: string | null;
  incorporationDate?: string | null;
  incorporationRegion?: string | null;
  businessAddress?: Record<string, unknown> | null;
  websiteUrl?: string | null;
  mccCode?: string | null;

  projectedMonthlyVolumeCents?: number | null;
  averageTicketCents?: number | null;
  currency?: string | null;

  // Optional plaintext — encrypted server-side. Sending `null` clears the
  // field; omitting the key leaves it untouched.
  taxId?: string | null;
  bankInfo?: {
    accountHolderName?: string | null;
    institutionNumber?: string | null;
    transitNumber?: string | null;
    accountNumber?: string | null;
    bankName?: string | null;
  } | null;

  // Extended fields (Phase 2c) — stored on businessAddress or as
  // dedicated columns where they exist. Anything without a matching
  // column is currently ignored (Step 2 metadata like currencies /
  // channels / high-risk flag lands in a follow-up patch to the
  // signer/notes area on submit).
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await requireOwner(request, tenantId);
  if (!auth.success) return auth.response;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Prefer the ID from the body; fall back to the most recent in-flight
  // row. Body-first lets the wizard target a specific application even
  // when a stale one lingers.
  const app = body.applicationId
    ? await prisma.merchantApplication.findFirst({
        where: { id: body.applicationId, tenantId, tenantRole: "MERCHANT" },
        select: { id: true, status: true },
      })
    : await prisma.merchantApplication.findFirst({
        where: {
          tenantId,
          tenantRole: "MERCHANT",
          status: { in: [...INFLIGHT_STATUSES] as any },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true },
      });

  if (!app) {
    return NextResponse.json({ error: "No application found" }, { status: 404 });
  }
  if (!EDITABLE_STATUSES.has(app.status)) {
    return NextResponse.json(
      {
        error: `Application is ${app.status} and can't be edited. Ask an admin to move it to INFO_REQUESTED if you need to update it.`,
      },
      { status: 409 }
    );
  }

  // Build the update payload — every field is optional, we only touch
  // what the client explicitly sent (Object.prototype.hasOwnProperty
  // beats `!== undefined` because `null` is a valid "clear" signal for
  // most fields).
  const data: Record<string, unknown> = {};
  const has = (k: keyof PatchBody) =>
    Object.prototype.hasOwnProperty.call(body, k);

  if (has("legalName") && typeof body.legalName === "string" && body.legalName.trim()) {
    data.legalName = body.legalName.trim().slice(0, 255);
  }
  if (has("dbaName")) data.dbaName = body.dbaName ? String(body.dbaName).trim().slice(0, 255) : null;
  if (has("businessTypeName")) data.businessTypeName = body.businessTypeName ? String(body.businessTypeName).trim().slice(0, 50) : null;
  if (has("incorporationDate")) data.incorporationDate = body.incorporationDate ? new Date(body.incorporationDate) : null;
  if (has("incorporationRegion")) data.incorporationRegion = body.incorporationRegion ? String(body.incorporationRegion).trim().slice(0, 100) : null;
  if (has("businessAddress")) data.businessAddress = body.businessAddress ?? null;
  if (has("websiteUrl")) data.websiteUrl = body.websiteUrl ? String(body.websiteUrl).trim().slice(0, 500) : null;
  if (has("mccCode")) {
    const raw = body.mccCode ? String(body.mccCode).trim() : null;
    if (raw && !/^\d{4}$/.test(raw)) {
      return NextResponse.json(
        { error: "MCC must be a 4-digit numeric code." },
        { status: 400 }
      );
    }
    data.mccCode = raw;
  }
  if (has("projectedMonthlyVolumeCents")) {
    data.projectedMonthlyVolumeCents =
      typeof body.projectedMonthlyVolumeCents === "number" && body.projectedMonthlyVolumeCents >= 0
        ? Math.round(body.projectedMonthlyVolumeCents)
        : null;
  }
  if (has("averageTicketCents")) {
    data.averageTicketCents =
      typeof body.averageTicketCents === "number" && body.averageTicketCents >= 0
        ? Math.round(body.averageTicketCents)
        : null;
  }
  if (has("currency") && body.currency) {
    data.currency = String(body.currency).toUpperCase().slice(0, 3);
  }

  // Sensitive fields — encrypt only when the caller explicitly sends them.
  // `null` clears, missing key leaves alone.
  if (has("taxId")) {
    data.taxIdEnc = body.taxId ? kybEncrypt(String(body.taxId).trim()) : null;
  }
  if (has("bankInfo")) {
    if (!body.bankInfo) {
      data.bankInfoEnc = null;
    } else {
      data.bankInfoEnc = kybEncryptJson({
        accountHolderName: body.bankInfo.accountHolderName?.trim() || null,
        institutionNumber: body.bankInfo.institutionNumber?.trim() || null,
        transitNumber: body.bankInfo.transitNumber?.trim() || null,
        accountNumber: body.bankInfo.accountNumber?.trim() || null,
        bankName: body.bankInfo.bankName?.trim() || null,
      });
    }
  }

  const updated = await prisma.merchantApplication.update({
    where: { id: app.id },
    data,
    include: {
      ubos: { orderBy: { createdAt: "asc" } },
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
    },
  });

  return NextResponse.json({ application: serializeApplication(updated) });
}
