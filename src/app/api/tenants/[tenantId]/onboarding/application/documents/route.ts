// POST /api/tenants/[tenantId]/onboarding/application/documents
//   Body: { docType, s3Key, originalFilename, mimeType, sizeBytes, sha256? }
//   Records a KybDocument row after a successful direct-to-S3 upload.
//   sha256 is optional — the wizard computes it when the browser can
//   (SubtleCrypto), otherwise we store an empty string. Server intentionally
//   does NOT re-hash from S3 here — that's expensive on a hot path and the
//   Phase 2e scan worker will HeadObject/GetObject anyway.
//
// GET /api/tenants/[tenantId]/onboarding/application/documents
//   Returns the current application's live (non-deleted) documents for the
//   wizard to hydrate on load.
//
// TENANT_OWNER only.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { KYB_ALLOWED_MIME_TYPES, KYB_DOC_TYPES, type KybDocTypeValue } from "@/lib/s3-kyb";

const EDITABLE_STATUSES = new Set<string>(["DRAFT", "INFO_REQUESTED"]);

async function requireOwner(request: NextRequest, tenantId: string) {
  const auth = await validateRequest(request, tenantId, "TENANT_OWNER");
  if (!auth.success) return auth as any;
  if (auth.context.membership.role !== "TENANT_OWNER") {
    return {
      success: false as const,
      response: NextResponse.json(
        { error: "Only the tenant owner can attach onboarding documents." },
        { status: 403 }
      ),
    };
  }
  return auth;
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

  const app = await prisma.merchantApplication.findFirst({
    where: { tenantId, tenantRole: "MERCHANT" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!app) return NextResponse.json({ documents: [] });

  const docs = await prisma.kybDocument.findMany({
    where: { applicationId: app.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      docType: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      scanStatus: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ documents: docs });
}

// -----------------------------------------------------------------------------
// POST
// -----------------------------------------------------------------------------

interface CreateBody {
  docType: KybDocTypeValue;
  s3Key: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await requireOwner(request, tenantId);
  if (!auth.success) return auth.response;

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!KYB_DOC_TYPES.includes(body.docType)) {
    return NextResponse.json({ error: `Unknown docType: ${body.docType}` }, { status: 400 });
  }
  if (!body.s3Key || typeof body.s3Key !== "string") {
    return NextResponse.json({ error: "s3Key is required." }, { status: 400 });
  }
  if (!body.originalFilename) {
    return NextResponse.json({ error: "originalFilename is required." }, { status: 400 });
  }
  if (!KYB_ALLOWED_MIME_TYPES.has(body.mimeType?.toLowerCase())) {
    return NextResponse.json({ error: `Unsupported mimeType: ${body.mimeType}` }, { status: 415 });
  }
  if (typeof body.sizeBytes !== "number" || body.sizeBytes <= 0) {
    return NextResponse.json({ error: "sizeBytes must be a positive number." }, { status: 400 });
  }

  const app = await prisma.merchantApplication.findFirst({
    where: { tenantId, tenantRole: "MERCHANT" },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (!app) {
    return NextResponse.json(
      { error: "No application to attach documents to." },
      { status: 404 }
    );
  }
  if (!EDITABLE_STATUSES.has(app.status)) {
    return NextResponse.json(
      { error: `Application is ${app.status} and can't be edited.` },
      { status: 409 }
    );
  }

  // Sanity: the presigned-url endpoint built the key with the tenant
  // prefix `kyb/<tenantId>/<applicationId>/...`. Re-verify here so a
  // client that reused an old presigned URL from a different application
  // can't sneak a foreign key onto this app.
  const expectedPrefix = `kyb/${tenantId}/${app.id}/`;
  if (!body.s3Key.startsWith(expectedPrefix)) {
    return NextResponse.json(
      { error: "s3Key does not belong to this tenant/application." },
      { status: 400 }
    );
  }

  const doc = await prisma.kybDocument.create({
    data: {
      applicationId: app.id,
      docType: body.docType,
      s3Key: body.s3Key,
      originalFilename: body.originalFilename.slice(0, 255),
      mimeType: body.mimeType.toLowerCase(),
      sizeBytes: body.sizeBytes,
      // 64-char hex sha256, or empty when the client couldn't compute one.
      // Constraint on the column is varchar(64), NOT NULL — empty string
      // satisfies the schema without lying about a hash we didn't run.
      sha256: (body.sha256 || "").slice(0, 64),
      uploadedByMembershipId: auth.context.membership.id,
      scanStatus: "PENDING",
    },
    select: {
      id: true,
      docType: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      scanStatus: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ document: doc });
}
