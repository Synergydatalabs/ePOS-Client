// /api/tenants/[tenantId]/integrations/sms
//
// GET    → current SMS config (masked secrets)
// PUT    → save settings; encrypts Twilio creds before write
// POST   → send a test SMS to a number (uses whatever provider is currently configured)
// DELETE → disable SMS / clear creds (back to "off")

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { encryptString } from "@/lib/crypto/encryption";
import { sendSms, getSmsStatus } from "@/lib/sms/client";

type Params = { tenantId: string };

// ---------- GET ----------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId } = await params;
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) return validation.response;

    const status = await getSmsStatus(tenantId);

    // Surface masked Twilio creds so the UI can show "•••• stored" hints
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        smsTwilioAccountSidEnc: true,
        smsTwilioAuthTokenEnc: true,
        smsConnectedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      sms: {
        enabled: status.enabled,
        provider: status.provider,
        configured: status.configured,
        senderLabel: status.senderLabel,
        twilioFromNumber: status.twilioFromNumber,
        twilioAccountSidStored: !!settings?.smsTwilioAccountSidEnc,
        twilioAuthTokenStored: !!settings?.smsTwilioAuthTokenEnc,
        connectedAt: settings?.smsConnectedAt?.toISOString() ?? null,
      },
    });
  } catch (err: any) {
    console.error("[sms GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load SMS settings" },
      { status: 500 }
    );
  }
}

// ---------- PUT ----------
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId } = await params;
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) return validation.response;

    const body = await request.json();
    const provider: "shared" | "twilio" =
      body.provider === "twilio" ? "twilio" : "shared";
    const enabled = body.enabled === true;
    const senderLabel: string | null =
      typeof body.senderLabel === "string" ? body.senderLabel.slice(0, 60) : null;

    const updateData: Record<string, unknown> = {
      smsEnabled: enabled,
      smsProvider: provider,
      smsSenderLabel: senderLabel,
    };

    // Twilio fields — only write if provided in the payload (blank means
    // "keep current value" so the form doesn't have to re-prompt for the
    // secrets every time the partner edits something else).
    if (provider === "twilio") {
      if (typeof body.twilioAccountSid === "string" && body.twilioAccountSid.trim()) {
        updateData.smsTwilioAccountSidEnc = encryptString(body.twilioAccountSid.trim());
      }
      if (typeof body.twilioAuthToken === "string" && body.twilioAuthToken.trim()) {
        updateData.smsTwilioAuthTokenEnc = encryptString(body.twilioAuthToken.trim());
      }
      if (typeof body.twilioFromNumber === "string" && body.twilioFromNumber.trim()) {
        updateData.smsTwilioFromNumber = body.twilioFromNumber.trim();
      }
    }

    if (enabled) {
      updateData.smsConnectedAt = new Date();
    }

    await prisma.tenantSettings.upsert({
      where: { tenantId },
      update: updateData,
      create: {
        tenantId,
        smsEnabled: enabled,
        smsProvider: provider,
        smsSenderLabel: senderLabel,
        smsConnectedAt: enabled ? new Date() : null,
        ...(provider === "twilio"
          ? {
              ...(typeof body.twilioAccountSid === "string" && body.twilioAccountSid.trim()
                ? { smsTwilioAccountSidEnc: encryptString(body.twilioAccountSid.trim()) }
                : {}),
              ...(typeof body.twilioAuthToken === "string" && body.twilioAuthToken.trim()
                ? { smsTwilioAuthTokenEnc: encryptString(body.twilioAuthToken.trim()) }
                : {}),
              ...(typeof body.twilioFromNumber === "string" && body.twilioFromNumber.trim()
                ? { smsTwilioFromNumber: body.twilioFromNumber.trim() }
                : {}),
            }
          : {}),
      },
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[sms PUT] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to save SMS settings" },
      { status: 500 }
    );
  }
}

// ---------- POST (test send) ----------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId } = await params;
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) return validation.response;

    const body = await request.json();
    const toPhone: string | undefined = body.toPhone;
    if (!toPhone) {
      return NextResponse.json({ error: "toPhone is required" }, { status: 400 });
    }

    const result = await sendSms({
      tenantId,
      to: toPhone,
      body: "✅ Test SMS from your ZASHX SMS integration.",
      category: "integration_test",
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error, provider: result.provider },
        { status: 400 }
      );
    }
    return NextResponse.json({
      success: true,
      provider: result.provider,
      messageId: result.messageId,
    });
  } catch (err: any) {
    console.error("[sms POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Test SMS failed" },
      { status: 500 }
    );
  }
}

// ---------- DELETE ----------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId } = await params;
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) return validation.response;

    await prisma.tenantSettings.update({
      where: { tenantId },
      data: {
        smsEnabled: false,
        smsTwilioAccountSidEnc: null,
        smsTwilioAuthTokenEnc: null,
        smsTwilioFromNumber: null,
        smsConnectedAt: null,
      },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[sms DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to disable SMS" },
      { status: 500 }
    );
  }
}
