// ============================================================================
// /api/tenants/[tenantId]/integrations/whatsapp
//
// GET    → status (connected? source? display name?) — never returns secrets
// PUT    → save manual-paste credentials (encrypts before write)
// POST   → test-send (proves stored creds work, sends "test" message to a number)
// DELETE → disconnect (clears tenant creds, fall back to shared platform)
//
// Auth: POS_ADMIN minimum — these credentials let the tenant SEND on their
// own Meta number, so write access must be restricted. GET status open to
// POS_MANAGER+ so reservation/waitlist staff can see the integration state.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import {
  encryptString,
  maskSecret,
} from "@/lib/crypto/encryption";
import {
  getTenantWhatsAppStatus,
  resolveMetaCredentialsForTenant,
} from "@/lib/whatsapp/credentials";
import { sendWhatsApp } from "@/lib/whatsapp/client";

// ----------------------------------------------------------------------------
// GET — status
// ----------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  const validation = await validateRequest(request, tenantId, "POS_MANAGER");
  if (!validation.success) return validation.response;

  try {
    const status = await getTenantWhatsAppStatus(tenantId);

    return NextResponse.json({
      success: true,
      whatsapp: {
        connected: status.connected,
        source: status.source,                          // 'tenant' | 'shared' | 'none'
        phoneNumberId: status.phoneNumberId,
        displayName: status.displayName,
        connectionType: status.connectionType,          // 'manual' | 'embedded' | 'shared' | null
        connectedAt: status.connectedAt,
        healthStatus: status.healthStatus,
        lastHealthCheckAt: status.lastHealthCheckAt,
        // Reminder for admins: shared sender shows ZashX brand. To use
        // YOUR business's brand, paste your own Meta credentials below.
        usingSharedSender: status.source === "shared",
      },
    });
  } catch (err: any) {
    console.error("[integrations/whatsapp GET] error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to read status" },
      { status: 500 }
    );
  }
}

// ----------------------------------------------------------------------------
// PUT — save (or replace) tenant-BYO credentials
// ----------------------------------------------------------------------------

// All fields required for a working "manual" connection. If a field is
// blank we treat it as "keep existing value" — useful for partial edits
// (e.g., rotating just the access token).
const putSchema = z.object({
  phoneNumberId: z.string().trim().min(5).max(64),
  wabaId: z.string().trim().min(5).max(64).optional().or(z.literal("")),
  accessToken: z.string().trim().min(20).optional().or(z.literal("")),
  appSecret: z.string().trim().min(8).optional().or(z.literal("")),
  webhookVerifyToken: z.string().trim().min(4).optional().or(z.literal("")),
  displayName: z.string().trim().max(255).optional().or(z.literal("")),
  connectionType: z.enum(["manual", "embedded"]).optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  const validation = await validateRequest(request, tenantId, "POS_ADMIN");
  if (!validation.success) return validation.response;

  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await request.json());
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: err?.errors ?? String(err) },
      { status: 400 }
    );
  }

  try {
    // Empty string = "keep existing", undefined = "keep existing". Non-empty = update.
    const updateData: Record<string, any> = {
      metaPhoneNumberId: body.phoneNumberId,
      metaConnectionType: body.connectionType ?? "manual",
      metaConnectedAt: new Date(),
    };

    if (body.wabaId)              updateData.metaWabaId                   = body.wabaId;
    if (body.displayName)         updateData.metaDisplayName              = body.displayName;
    if (body.accessToken)         updateData.metaAccessTokenEnc           = encryptString(body.accessToken);
    if (body.appSecret)           updateData.metaAppSecretEnc             = encryptString(body.appSecret);
    if (body.webhookVerifyToken)  updateData.metaWebhookVerifyTokenEnc    = encryptString(body.webhookVerifyToken);

    // Reset health status — a re-save is treated as "user fixed something",
    // background job will re-check on next cycle.
    updateData.metaHealthStatus = "unknown";

    await prisma.tenant.update({
      where: { id: tenantId },
      data: updateData,
    });

    const status = await getTenantWhatsAppStatus(tenantId);

    return NextResponse.json({
      success: true,
      whatsapp: {
        connected: status.connected,
        source: status.source,
        phoneNumberId: status.phoneNumberId,
        displayName: status.displayName,
        connectionType: status.connectionType,
        connectedAt: status.connectedAt,
        // Helpful echo so admin UI can show "your token ends in …x9k2"
        // without exposing the full secret in any future response.
        accessTokenPreview: body.accessToken ? maskSecret(body.accessToken) : null,
      },
    });
  } catch (err: any) {
    console.error("[integrations/whatsapp PUT] error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to save credentials" },
      { status: 500 }
    );
  }
}

// ----------------------------------------------------------------------------
// POST — test-send
// Body: { toPhone: string }
// Sends a hardcoded test message using the resolved credentials. Useful for
// "Save & test" button in admin UI — proves end-to-end before staff rely on it.
// ----------------------------------------------------------------------------

const postSchema = z.object({
  toPhone: z.string().trim().min(7).max(30),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  const validation = await validateRequest(request, tenantId, "POS_ADMIN");
  if (!validation.success) return validation.response;

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await request.json());
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: err?.errors ?? String(err) },
      { status: 400 }
    );
  }

  // Confirm we have ANY usable creds — surface a clean error if not.
  const resolved = await resolveMetaCredentialsForTenant(tenantId);
  if (!resolved) {
    return NextResponse.json(
      {
        success: false,
        error: "No WhatsApp credentials configured (neither tenant nor shared).",
      },
      { status: 400 }
    );
  }

  const result = await sendWhatsApp({
    kind: "text",
    tenantId,
    to: body.toPhone,
    body:
      "✅ Test message from your ZashX integration. If you can read this, " +
      "your WhatsApp Business connection is working.",
    category: "integration_test",
  });

  return NextResponse.json({
    success: result.ok,
    provider: result.provider,
    credentialSource: result.credentialSource,
    messageId: result.messageId,
    error: result.error,
  });
}

// ----------------------------------------------------------------------------
// DELETE — disconnect (clear tenant creds, fall back to shared platform)
// ----------------------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  const validation = await validateRequest(request, tenantId, "POS_ADMIN");
  if (!validation.success) return validation.response;

  try {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        metaPhoneNumberId: null,
        metaWabaId: null,
        metaAccessTokenEnc: null,
        metaAppSecretEnc: null,
        metaWebhookVerifyTokenEnc: null,
        metaDisplayName: null,
        metaConnectionType: null,
        metaConnectedAt: null,
        metaHealthStatus: null,
        metaLastHealthCheckAt: null,
      },
    });

    return NextResponse.json({ success: true, disconnected: true });
  } catch (err: any) {
    console.error("[integrations/whatsapp DELETE] error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Failed to disconnect" },
      { status: 500 }
    );
  }
}
