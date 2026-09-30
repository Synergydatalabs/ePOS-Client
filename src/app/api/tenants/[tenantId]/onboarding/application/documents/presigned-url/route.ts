// POST /api/tenants/[tenantId]/onboarding/application/documents/presigned-url
//
// Body: { docType, filename, mimeType, sizeBytes }
// Returns { url, s3Key, headers, expiresAt } — client uploads the file
// directly to S3 with a PUT to `url`, using the exact headers we return
// (Content-Type must match — the presigned signature covers it).
//
// Enforces:
//   - TENANT_OWNER auth
//   - Application in DRAFT / INFO_REQUESTED
//   - docType in the KYB enum
//   - MIME in the KYB allow-list (PDF / JPG / PNG / HEIC)
//   - File ≤ 10 MB and total application docs ≤ 50 MB
//
// Does NOT create the KybDocument row — that happens in a follow-up POST
// once the client confirms the upload finished. Presigned URLs that never
// get used just expire.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import {
  buildKybKey,
  getKybUploadUrl,
  KYB_ALLOWED_MIME_TYPES,
  KYB_DOC_TYPES,
  KYB_MAX_BYTES_PER_APPLICATION,
  KYB_MAX_BYTES_PER_FILE,
  type KybDocTypeValue,
} from "@/lib/s3-kyb";

const EDITABLE_STATUSES = new Set<string>(["DRAFT", "INFO_REQUESTED"]);

async function requireOwner(request: NextRequest, tenantId: string) {
  const auth = await validateRequest(request, tenantId, "TENANT_OWNER");
  if (!auth.success) return auth as any;
  if (auth.context.membership.role !== "TENANT_OWNER") {
    return {
      success: false as const,
      response: NextResponse.json(
        { error: "Only the tenant owner can upload onboarding documents." },
        { status: 403 }
      ),
    };
  }
  return auth;
}

interface PresignBody {
  docType: KybDocTypeValue;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await requireOwner(request, tenantId);
  if (!auth.success) return auth.response;

  let body: PresignBody;
  try {
    body = (await request.json()) as PresignBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // --- Validation ---
  if (!KYB_DOC_TYPES.includes(body.docType)) {
    return NextResponse.json({ error: `Unknown docType: ${body.docType}` }, { status: 400 });
  }
  if (!body.filename || body.filename.length > 255) {
    return NextResponse.json({ error: "filename is required (≤ 255 chars)." }, { status: 400 });
  }
  const mime = (body.mimeType || "").toLowerCase();
  if (!KYB_ALLOWED_MIME_TYPES.has(mime)) {
    return NextResponse.json(
      {
        error: `Unsupported file type: ${body.mimeType}. Allowed: ${[...KYB_ALLOWED_MIME_TYPES].join(", ")}`,
      },
      { status: 415 }
    );
  }
  if (typeof body.sizeBytes !== "number" || body.sizeBytes <= 0) {
    return NextResponse.json({ error: "sizeBytes must be a positive number." }, { status: 400 });
  }
  if (body.sizeBytes > KYB_MAX_BYTES_PER_FILE) {
    return NextResponse.json(
      {
        error: `File too large: ${(body.sizeBytes / 1024 / 1024).toFixed(1)}MB (max 10MB per file).`,
      },
      { status: 413 }
    );
  }

  // --- Application + total-size cap ---
  const app = await prisma.merchantApplication.findFirst({
    where: { tenantId, tenantRole: "MERCHANT" },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  if (!app) {
    return NextResponse.json(
      { error: "Start the application (Step 1) before uploading documents." },
      { status: 404 }
    );
  }
  if (!EDITABLE_STATUSES.has(app.status)) {
    return NextResponse.json(
      { error: `Application is ${app.status} and can't accept new documents.` },
      { status: 409 }
    );
  }

  const totalAgg = await prisma.kybDocument.aggregate({
    where: { applicationId: app.id, deletedAt: null },
    _sum: { sizeBytes: true },
  });
  const currentTotal = totalAgg._sum.sizeBytes ?? 0;
  if (currentTotal + body.sizeBytes > KYB_MAX_BYTES_PER_APPLICATION) {
    return NextResponse.json(
      {
        error: `Adding this file would exceed the 50MB total limit for this application. Currently used: ${(currentTotal / 1024 / 1024).toFixed(1)}MB.`,
      },
      { status: 413 }
    );
  }

  // --- Sign ---
  const s3Key = buildKybKey({
    tenantId,
    applicationId: app.id,
    docType: body.docType,
    filename: body.filename,
  });
  const signed = await getKybUploadUrl({
    s3Key,
    mimeType: mime,
    sizeBytes: body.sizeBytes,
  });

  return NextResponse.json({
    s3Key,
    url: signed.url,
    headers: signed.headers,
    expiresAt: signed.expiresAt,
  });
}
