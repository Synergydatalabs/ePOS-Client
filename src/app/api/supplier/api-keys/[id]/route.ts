// Phase I #6 (2026-09-18) — supplier API-key mutation.
//
//   PATCH  /api/supplier/api-keys/[id]   → enable/disable + rename
//   DELETE /api/supplier/api-keys/[id]   → revoke (soft — key can never
//                                          be re-enabled; plaintext is
//                                          already unrecoverable).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";

interface Params {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await getPartnerSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.apiKey.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, revokedAt: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.revokedAt) {
    return NextResponse.json(
      { error: "Key is revoked and can no longer be modified" },
      { status: 400 }
    );
  }

  let body: { name?: unknown; enabled?: unknown } = {};
  try {
    body = (await request.json()) as { name?: unknown; enabled?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: { name?: string; enabled?: boolean } = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim().slice(0, 120);
  }
  if (typeof body.enabled === "boolean") {
    data.enabled = body.enabled;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.apiKey.update({
    where: { id: existing.id },
    data,
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      keyLast4: true,
      enabled: true,
      lastUsedAt: true,
      createdAt: true,
      revokedAt: true,
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const session = await getPartnerSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.apiKey.findFirst({
    where: { id, tenantId: session.tenantId },
    select: { id: true, revokedAt: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.revokedAt) {
    return NextResponse.json({ ok: true, alreadyRevoked: true });
  }

  await prisma.apiKey.update({
    where: { id: existing.id },
    data: { enabled: false, revokedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
