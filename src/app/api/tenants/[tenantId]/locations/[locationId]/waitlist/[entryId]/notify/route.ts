// ============================================================================
// POST /api/.../waitlist/[entryId]/notify
//
// Sends "table almost ready" notification to the guest + marks entry status
// NOTIFIED. Supports SMS (default), WhatsApp, or both.
//
// Body: { channel?: "SMS" | "WHATSAPP" | "BOTH" }  (default "SMS")
//
// Inbound replies are handled by:
//   - /api/webhooks/twilio-sms      (SMS — 1/9 replies auto-update status)
//   - /api/webhooks/whatsapp        (WhatsApp — same)
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { sendSms } from "@/lib/sms/client";
import { waitlistNotifyMessage } from "@/lib/sms/templates";
import { sendWhatsApp } from "@/lib/whatsapp/client";
import { waitlistNotifyText } from "@/lib/whatsapp/templates";

const bodySchema = z.object({
  channel: z.enum(["SMS", "WHATSAPP", "BOTH"]).optional().default("SMS"),
});

export async function POST(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ tenantId: string; locationId: string; entryId: string }>;
  }
) {
  try {
    const { tenantId, locationId, entryId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const entry = await prisma.waitlistEntry.findFirst({
      where: {
        id: entryId,
        locationId,
        location: { tenantId },
      },
      include: {
        location: { include: { tenant: { select: { name: true } } } },
      },
    });
    if (!entry) {
      return NextResponse.json({ error: "Waitlist entry not found" }, { status: 404 });
    }

    if (entry.status !== "WAITING") {
      return NextResponse.json(
        {
          error: `Cannot notify guest from status ${entry.status}. Must be WAITING.`,
        },
        { status: 409 }
      );
    }

    // Channel selection — default SMS, override via body
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    const channel = parsed.success ? parsed.data.channel : "SMS";

    const restaurantName = entry.location.tenant.name || "Restaurant";
    const ctx = {
      restaurantName,
      customerName: entry.customerName,
      partySize: entry.partySize,
    };

    let smsResult: Awaited<ReturnType<typeof sendSms>> | null = null;
    let waResult: Awaited<ReturnType<typeof sendWhatsApp>> | null = null;

    if (channel === "SMS" || channel === "BOTH") {
      smsResult = await sendSms({
        tenantId,
        to: entry.customerPhone,
        body: waitlistNotifyMessage(ctx),
        category: "waitlist_notify",
      });
    }

    if (channel === "WHATSAPP" || channel === "BOTH") {
      // Free-form text — works if guest is in 24h window OR you've registered
      // pre-approved "waitlist_notify" template (next minor update will swap
      // to template-based send for cold contacts).
      waResult = await sendWhatsApp({
        kind: "text",
        tenantId,
        to: entry.customerPhone,
        body: waitlistNotifyText({ restaurantName, customerName: entry.customerName }),
        category: "waitlist_notify",
      });
    }

    // Update status regardless of send success
    const updated = await prisma.waitlistEntry.update({
      where: { id: entryId },
      data: {
        status: "NOTIFIED",
        smsSentAt: new Date(),
      },
    });

    return NextResponse.json({
      entry: updated,
      channel,
      sms: smsResult,
      whatsapp: waResult,
    });
  } catch (err: any) {
    console.error("[waitlist notify] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to notify guest" },
      { status: 500 }
    );
  }
}
