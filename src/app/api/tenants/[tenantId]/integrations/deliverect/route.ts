// GET /api/tenants/[tenantId]/integrations/deliverect
//   Returns the current connection state (never returns the actual
//   secret values — only whether they're set).
//
// PUT /api/tenants/[tenantId]/integrations/deliverect
//   Body: { apiKey?, apiSecret?, externalLocationId?, connected? }
//   Merchant enters their Deliverect account credentials. Secrets are
//   encrypted before write. Set connected=true to flip status.
//
// DELETE /api/tenants/[tenantId]/integrations/deliverect
//   Wipes all creds + status = DISCONNECTED.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { encryptToken } from "@/lib/integration-crypto";

type Params = { params: Promise<{ tenantId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const conn = await prisma.integrationConnection.findUnique({
      where: {
        tenantId_provider: { tenantId, provider: "DELIVERECT" },
      },
      select: {
        id: true,
        status: true,
        externalLocationId: true,
        lastSyncAt: true,
        lastError: true,
        lastErrorAt: true,
        connectedAt: true,
        apiKeyEnc: true,
        apiSecretEnc: true,
        webhookSecretEnc: true,
      },
    });

    // Never leak the encrypted values or the plaintexts. Just booleans
    // so the UI can render a "set / not set" state.
    return NextResponse.json({
      success: true,
      connection: conn
        ? {
            id: conn.id,
            status: conn.status,
            externalLocationId: conn.externalLocationId,
            lastSyncAt: conn.lastSyncAt,
            lastError: conn.lastError,
            lastErrorAt: conn.lastErrorAt,
            connectedAt: conn.connectedAt,
            apiKeySet: !!conn.apiKeyEnc,
            apiSecretSet: !!conn.apiSecretEnc,
            webhookSecretSet: !!conn.webhookSecretEnc,
          }
        : null,
    });
  } catch (error: any) {
    console.error("[deliverect GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const {
      apiKey,
      apiSecret,
      externalLocationId,
      connected,
    } = body as {
      apiKey?: string;
      apiSecret?: string;
      externalLocationId?: string;
      connected?: boolean;
    };

    // Merchants POST only the fields they're changing. Empty strings
    // are treated as "leave existing value alone" — to clear a creden-
    // tial they'd use DELETE.
    const updates: any = {};
    if (apiKey) updates.apiKeyEnc = encryptToken(apiKey);
    if (apiSecret) updates.apiSecretEnc = encryptToken(apiSecret);
    if (externalLocationId !== undefined) {
      updates.externalLocationId = externalLocationId || null;
    }
    if (connected === true) {
      updates.status = "CONNECTED";
      updates.connectedAt = new Date();
      updates.connectedById = auth.context.membership.id;
      updates.lastError = null;
      updates.lastErrorAt = null;
    }

    const conn = await prisma.integrationConnection.upsert({
      where: {
        tenantId_provider: { tenantId, provider: "DELIVERECT" },
      },
      create: {
        tenantId,
        provider: "DELIVERECT",
        ...updates,
      },
      update: updates,
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: conn.id,
        status: conn.status,
        externalLocationId: conn.externalLocationId,
      },
    });
  } catch (error: any) {
    console.error("[deliverect PUT] error:", error);
    return NextResponse.json(
      { error: error?.message || "Update failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    await prisma.integrationConnection.updateMany({
      where: { tenantId, provider: "DELIVERECT" },
      data: {
        status: "DISCONNECTED",
        apiKeyEnc: null,
        apiSecretEnc: null,
        webhookSecretEnc: null,
        externalLocationId: null,
      },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[deliverect DELETE] error:", error);
    return NextResponse.json(
      { error: error?.message || "Disconnect failed" },
      { status: 500 }
    );
  }
}
