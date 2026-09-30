// Phase I #6 (2026-09-18) — supplier portal API-key management.
//
//   GET  /api/supplier/api-keys   → list this tenant's keys (masked)
//   POST /api/supplier/api-keys   → mint a new key. Returns plaintext ONCE.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import { mintApiKey } from "@/lib/api-keys";

export async function GET(request: NextRequest) {
  const session = await getPartnerSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const keys = await prisma.apiKey.findMany({
    where: { tenantId: session.tenantId },
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      keyLast4: true,
      enabled: true,
      lastUsedAt: true,
      lastUsedIp: true,
      createdAt: true,
      revokedAt: true,
    },
  });

  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const session = await getPartnerSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { name?: unknown } = {};
  try {
    body = (await request.json()) as { name?: unknown };
  } catch {
    /* body is optional — default name is used */
  }
  const rawName = typeof body.name === "string" ? body.name.trim() : "";
  const name = rawName ? rawName.slice(0, 120) : `Key ${new Date().toISOString().slice(0, 10)}`;

  const minted = mintApiKey();

  const created = await prisma.apiKey.create({
    data: {
      tenantId: session.tenantId,
      name,
      keyHash: minted.keyHash,
      keyLast4: minted.keyLast4,
      keyPrefix: minted.keyPrefix,
      createdByMembershipId: session.memberId ?? null,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      keyLast4: true,
      enabled: true,
      createdAt: true,
    },
  });

  // Plaintext returned ONCE in this response — never again. UI must
  // surface a "copy this now" step.
  return NextResponse.json({ ...created, plaintext: minted.plaintext }, { status: 201 });
}
