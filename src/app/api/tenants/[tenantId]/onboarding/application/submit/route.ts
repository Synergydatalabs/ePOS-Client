// POST /api/tenants/[tenantId]/onboarding/application/submit
//
// Body: { signerName, signerTitle, signerEmail, consented }
// Transitions the current DRAFT (or INFO_REQUESTED) MerchantApplication
// to SUBMITTED, writes the signer info onto the row, and appends an
// ApplicationEvent capturing the transition.
//
// Validation runs on all wizard-required fields — business info, tax id,
// bank info, at least 1 UBO summing to ≥ 100 %, and the required core
// docs (articles of incorporation + void cheque). Missing pieces come
// back as a structured error list so the client can highlight the guilty
// step.
//
// TENANT_OWNER only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { KYB_REQUIRED_DOC_TYPES } from "@/lib/s3-kyb";

const SUBMITTABLE_STATUSES = new Set<string>(["DRAFT", "INFO_REQUESTED"]);

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

interface SubmitBody {
  signerName?: string;
  signerTitle?: string;
  signerEmail?: string;
  consented?: boolean;
  // Anything else the wizard wants to preserve in the audit trail — we
  // stash it in ApplicationEvent.note as JSON so the schema stays put.
  metadata?: Record<string, unknown>;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await requireOwner(request, tenantId);
  if (!auth.success) return auth.response;

  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // --- Load app + relations ---
  const app = await prisma.merchantApplication.findFirst({
    where: { tenantId, tenantRole: "MERCHANT" },
    orderBy: { createdAt: "desc" },
    include: {
      ubos: true,
      documents: { where: { deletedAt: null } },
    },
  });
  if (!app) {
    return NextResponse.json({ error: "No application to submit." }, { status: 404 });
  }
  if (!SUBMITTABLE_STATUSES.has(app.status)) {
    return NextResponse.json(
      { error: `Application is ${app.status}; only DRAFT or INFO_REQUESTED can be submitted.` },
      { status: 409 }
    );
  }

  // --- Validate signer + consent ---
  const missing: string[] = [];
  const signerName = body.signerName?.trim() || "";
  const signerTitle = body.signerTitle?.trim() || "";
  const signerEmail = body.signerEmail?.trim().toLowerCase() || "";
  if (!signerName) missing.push("signer name");
  if (!signerTitle) missing.push("signer title");
  if (!signerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) {
    missing.push("valid signer email");
  }
  if (!body.consented) missing.push("consent checkbox");

  // --- Validate business core fields ---
  if (!app.legalName || app.legalName.startsWith("(draft")) missing.push("legal business name");
  if (!app.businessAddress) missing.push("business address");
  if (!app.mccCode) missing.push("MCC code");

  // --- Sensitive fields present? ---
  if (!app.taxIdEnc) missing.push("tax ID");
  if (!app.bankInfoEnc) missing.push("bank account info");

  // --- Financial projections ---
  if (app.projectedMonthlyVolumeCents == null) missing.push("projected monthly volume");
  if (app.averageTicketCents == null) missing.push("average ticket size");

  // --- UBOs ---
  if (app.ubos.length === 0) {
    missing.push("at least one Ultimate Beneficial Owner");
  } else {
    const totalPct = app.ubos.reduce(
      (sum, u) => sum + Number(u.ownershipPct),
      0
    );
    if (totalPct < 100) {
      missing.push(
        `UBO ownership totals ${totalPct.toFixed(2)}% (must sum to 100% or more)`
      );
    }
  }

  // --- Documents: required core set + per-UBO docs ---
  const docTypesPresent = new Set(app.documents.map((d) => d.docType));
  for (const required of KYB_REQUIRED_DOC_TYPES) {
    if (!docTypesPresent.has(required)) {
      missing.push(`document: ${required.replaceAll("_", " ").toLowerCase()}`);
    }
  }
  // Every UBO needs at least ONE ID doc (front or back) attached to the
  // application. Cheap check — we don't try to bind docs to specific UBOs
  // in Phase 2c; that's a Phase 2d refinement.
  if (app.ubos.length > 0) {
    const hasUboId =
      docTypesPresent.has("UBO_ID_FRONT") ||
      docTypesPresent.has("UBO_ID_BACK") ||
      docTypesPresent.has("DIRECTOR_ID");
    if (!hasUboId) {
      missing.push("at least one UBO / Director ID document");
    }
  }

  if (missing.length > 0) {
    return NextResponse.json(
      {
        error: "Application is not yet complete.",
        missing,
      },
      { status: 422 }
    );
  }

  // --- Transition ---
  // Snapshot the signer + a minimal audit blob into ApplicationEvent.note
  // as JSON — schema stays untouched (task requirement) and the admin
  // timeline can decode it if needed.
  const auditPayload = {
    signerName,
    signerTitle,
    signerEmail,
    consentedAt: new Date().toISOString(),
    metadata: body.metadata ?? null,
    // IP / UA useful for compliance forensics if someone later disputes
    // that they authorized submission.
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent") ?? null,
  };

  const [updated] = await prisma.$transaction([
    prisma.merchantApplication.update({
      where: { id: app.id },
      data: {
        status: "SUBMITTED",
        signerName,
        signerTitle,
        signerEmail,
        signerConsentedAt: new Date(),
        submittedAt: new Date(),
      },
    }),
    prisma.applicationEvent.create({
      data: {
        applicationId: app.id,
        fromStatus: app.status,
        toStatus: "SUBMITTED",
        actorType: "MERCHANT",
        actorId: auth.context.membership.id,
        note: JSON.stringify(auditPayload),
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    application: {
      id: updated.id,
      status: updated.status,
      submittedAt: updated.submittedAt,
    },
  });
}
