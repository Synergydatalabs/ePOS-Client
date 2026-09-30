// ============================================================================
// POST /api/webhooks/twilio-sms
//
// Twilio sends inbound SMS here as application/x-www-form-urlencoded body.
// Configure in Twilio Console → Phone Numbers → your number → Messaging
//   Webhook for "A MESSAGE COMES IN" → https://itap.zashx.com/api/webhooks/twilio-sms
//   HTTP POST
//
// SECURITY:
//   Twilio signs requests with X-Twilio-Signature header.
//   We verify using TWILIO_AUTH_TOKEN to ensure the request is genuinely
//   from Twilio (and not someone spoofing the endpoint).
//
// PARSE LOGIC: same as WhatsApp webhook — look for "1"/"9" replies and
// update the most recent NOTIFIED waitlist entry from this phone.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { sendSms } from "@/lib/sms/client";
import { waitlistConfirmedReplyText, waitlistRemovedReplyText } from "@/lib/whatsapp/templates";

/**
 * Verify Twilio's X-Twilio-Signature header.
 * Algorithm: HMAC-SHA1 of (url + sorted_params_concat) using AUTH_TOKEN as key.
 */
function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | null
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signature) {
    return !authToken; // dev mode: allow if no auth token configured
  }
  const sortedKeys = Object.keys(params).sort();
  const data = url + sortedKeys.map((k) => k + params[k]).join("");
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(data, "utf8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  try {
    // Parse form-urlencoded body
    const rawBody = await request.text();
    const formParams = Object.fromEntries(
      new URLSearchParams(rawBody) as any
    ) as Record<string, string>;

    // Verify signature
    const signature = request.headers.get("x-twilio-signature");
    const url = process.env.TWILIO_WEBHOOK_URL ||
      `https://${request.headers.get("host")}${request.nextUrl.pathname}`;

    if (!verifyTwilioSignature(url, formParams, signature)) {
      console.warn("[twilio-sms webhook] signature verification failed");
      return new NextResponse("Forbidden", { status: 403 });
    }

    const from = formParams.From || ""; // E.164, e.g. "+14165551234"
    const body = (formParams.Body || "").trim();
    const messageSid = formParams.MessageSid || "";

    console.log(`[twilio-sms inbound] from=${from} sid=${messageSid} text="${body.slice(0, 50)}"`);

    // Process async — return TwiML quickly so Twilio doesn't retry
    void handleInboundSms(from, body).catch((err) =>
      console.error("[twilio-sms webhook] processing error:", err)
    );

    // Empty TwiML response — Twilio expects XML. Empty Response = no auto-reply
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`,
      {
        status: 200,
        headers: { "Content-Type": "text/xml" },
      }
    );
  } catch (err: any) {
    console.error("[twilio-sms webhook] error:", err);
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Response></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }
}

/**
 * Parse "1" / "9" replies and update matching NOTIFIED waitlist entry.
 */
async function handleInboundSms(from: string, body: string) {
  const isConfirm = body === "1" || /^\s*1\b/.test(body);
  const isCancel = body === "9" || /^\s*9\b/.test(body);

  if (!isConfirm && !isCancel) {
    // Generic inbound — Phase 5d will store these in a conversation table
    return;
  }

  const candidates = await prisma.waitlistEntry.findMany({
    where: {
      status: "NOTIFIED",
      smsSentAt: { gte: new Date(Date.now() - 30 * 60_000) },
    },
    orderBy: { smsSentAt: "desc" },
    take: 50,
  });

  const fromDigits = from.replace(/\D/g, "");
  const matched = candidates.find(
    (e) => e.customerPhone.replace(/\D/g, "") === fromDigits
  );
  if (!matched) {
    console.log(`[twilio-sms inbound] no matching NOTIFIED waitlist for ${from}`);
    return;
  }

  const newStatus = isConfirm ? "CONFIRMED" : "CANCELLED";
  await prisma.waitlistEntry.update({
    where: { id: matched.id },
    data: {
      status: newStatus,
      smsReplyAt: new Date(),
      smsReplyValue: isConfirm ? "1" : "9",
    },
  });

  // Send acknowledgement
  const location = await prisma.location.findUnique({
    where: { id: matched.locationId },
    include: { tenant: { select: { id: true, name: true } } },
  });
  if (!location) return;

  const ackText = isConfirm
    ? waitlistConfirmedReplyText({
        restaurantName: location.tenant.name,
        customerName: matched.customerName,
      })
    : waitlistRemovedReplyText({
        restaurantName: location.tenant.name,
        customerName: matched.customerName,
      });

  await sendSms({
    tenantId: location.tenant.id,
    to: matched.customerPhone,
    body: ackText,
    category: "waitlist_ack",
  });

  console.log(`[twilio-sms inbound] waitlist ${matched.id} → ${newStatus}`);
}
