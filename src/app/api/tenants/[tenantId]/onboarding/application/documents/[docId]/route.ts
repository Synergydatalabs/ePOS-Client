// DELETE /api/tenants/[tenantId]/onboarding/application/documents/[docId]
//
// Soft-deletes the KybDocument row (sets deletedAt). The S3 object is
// deliberately LEFT IN PLACE — a nightly cleanup can hard-delete objects
// whose row has been soft-deleted for > N days. This keeps a mis-upload
// reversible for the entire review window without leaving an admin-visible
// stale row.
//
// TENANT_OWNER only. Rejects unless parent application is DRAFT /
// INFO_REQUESTED.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";

const EDITABLE_STATUSES = new Set<string>(["DRAFT", "INFO_REQUESTED"]);

async function requireOwner(request: NextRequest, tenantId: string) {
  const auth = await validateRequest(request, tenantId, "TENANT_OWNER");
  if (!auth.success) return auth as any;
  if (auth.context.membership.role !== "TENANT_OWNER") {
    return {
      success: false as const,
      response: NextResponse.json(
        { error: "Only the tenant owner can delete onboarding documents." },
        { status: 403 }
      ),
    };
  }
  return auth;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; docId: string }> }
) {
  const { tenantId, docId } = await params;
  const auth = await requireOwner(request, tenantId);
  if (!auth.success) return auth.response;

  const doc = await prisma.kybDocument.findUnique({
    where: { id: docId },
    include: {
      application: {
        select: { id: true, tenantId: true, tenantRole: true, status: true },
      },
    },
  });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });
  if (doc.application.tenantId !== tenantId || doc.application.tenantRole !== "MERCHANT") {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  if (!EDITABLE_STATUSES.has(doc.application.status)) {
    return NextResponse.json(
      { error: `Application is ${doc.application.status} and can't be edited.` },
      { status: 409 }
    );
  }
  if (doc.deletedAt) {
    // Already deleted — idempotent success.
    return NextResponse.json({ ok: true });
  }

  await prisma.kybDocument.update({
    where: { id: docId },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
