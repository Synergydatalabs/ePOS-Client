// ============================================================================
// /api/webhooks/whatsapp
//
//   GET  → Meta verification handshake (one-time when you set webhook URL)
//   POST → inbound message events (guests replying to your messages)
//
// We use this for:
//   1. Waitlist reply parsing — guest replies "1" → CONFIRMED, "9" → CANCELLED
//   2. (Phase 5d-future) Generic conversation logging — store everything else
//      in conversation_messages for staff to review in an inbox
//
// PHASE 5d MULTI-TENANT ROUTING:
//   Meta tells us WHICH of our connected numbers received the message via
//   `value.metadata.phone_number_id`. We reverse-lookup the tenant that owns
//   that phone_number_id and scope ALL downstream queries to that tenant.
//
//   If no tenant owns it (e.g., the message hit the shared ZashX sender),
//   we fall back to the legacy "scan all NOTIFIED waitlist" behaviour —
//   which is correct because shared-sender users all share one number.
//
// SECURITY:
//   - Meta sends X-Hub-Signature-256 — verified with app secret
//   - For tenant-BYO connections, the app secret is per-tenant (each tenant
//     registered their OWN Meta app). We try shared first, then per-tenant.
//   - GET handshake compares ?hub.verify_token against shared platform token
//     (Meta only allows ONE callback URL per app, so verify token is platform-wide)
//
// Meta retries failed deliveries — we MUST return 200 quickly even if
// processing fails downstream.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import { sendWhatsApp } from "@/lib/whatsapp/client";
import {
  waitlistConfirmedReplyText,
  waitlistRemovedReplyText,
} from "@/lib/whatsapp/templates";
import {
  findTenantByPhoneNumberId,
  getSharedAppSecret,
  getSharedWebhookVerifyToken,
} from "@/lib/whatsapp/credentials";
import { decryptString } from "@/lib/crypto/encryption";

// ============================================================================
// GET — Verification handshake
// ============================================================================

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const expectedToken = getSharedWebhookVerifyToken();

  if (mode === "subscribe" && token && expectedToken && token === expectedToken) {
    // Meta expects us to echo the challenge as plain text
    return new NextResponse(challenge || "", { status: 200 });
  }

  // ALSO check per-tenant verify tokens — if a manual-setup tenant uses a
  // DIFFERENT verify token in their Meta app config, support that too. This
  // is rare (most tenants will share the platform token), but it lets each
  // tenant operate fully independently if they want.
  if (mode === "subscribe" && token) {
    const tenants = await prisma.tenant.findMany({
      where: { metaWebhookVerifyTokenEnc: { not: null } },
      select: { metaWebhookVerifyTokenEnc: true },
    }).catch(() => []);
    for (const t of tenants) {
      try {
        const decrypted = decryptString(t.metaWebhookVerifyTokenEnc);
        if (decrypted && decrypted === token) {
          return new NextResponse(challenge || "", { status: 200 });
        }
      } catch {
        // ignore decrypt failures — try next tenant
      }
    }
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// ============================================================================
// POST — Inbound message events
// ============================================================================

/**
 * Verify Meta's HMAC signature on the request body.
 *
 * For shared-sender messages: use the platform app secret from env.
 * For tenant-BYO messages: we need the tenant's app secret. But we haven't
 * parsed the payload yet to know which tenant it's for — chicken-and-egg.
 *
 * Resolution: try shared first (covers 99% of traffic). If that fails AND
 * we have at least one tenant with a per-tenant app secret, parse the body
 * to find the phone_number_id, look up the tenant, and verify against THAT
 * tenant's secret. This is more expensive but only fires on shared-secret
 * mismatch, so cost stays bounded.
 */
async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) {
    // No signature provided. If neither shared nor any tenant secret is set,
    // allow (dev mode). In prod with secrets set, this rejects.
    const sharedSecret = getSharedAppSecret();
    if (!sharedSecret) {
      const tenantCount = await prisma.tenant.count({
        where: { metaAppSecretEnc: { not: null } },
      }).catch(() => 0);
      if (tenantCount === 0) return true; // pure dev
    }
    return false;
  }

  // Try shared first
  const sharedSecret = getSharedAppSecret();
  if (sharedSecret) {
    const expected = computeSig(rawBody, sharedSecret);
    if (timingEq(expected, signature)) return true;
  }

  // Try per-tenant secrets — find the tenant by phone_number_id from the body
  let parsed: any = null;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const phoneNumberId =
    parsed?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  if (!phoneNumberId) return false;

  const tenant = await prisma.tenant.findFirst({
    where: { metaPhoneNumberId: phoneNumberId },
    select: { metaAppSecretEnc: true },
  }).catch(() => null);

  if (!tenant?.metaAppSecretEnc) return false;

  try {
    const tenantSecret = decryptString(tenant.metaAppSecretEnc);
    if (!tenantSecret) return false;
    const expected = computeSig(rawBody, tenantSecret);
    return timingEq(expected, signature);
  } catch {
    return false;
  }
}

function computeSig(rawBody: string, secret: string): string {
  return (
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
  );
}

function timingEq(expected: string, given: string): boolean {
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  } catch {
    return false;
  }
}

interface WhatsAppMessage {
  from: string;      // phone (digits only)
  id: string;
  timestamp: string;
  type: string;      // text, button, interactive, etc.
  text?: { body: string };
  button?: { payload: string; text: string };
}

interface WhatsAppValue {
  messaging_product: string;
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: Array<{ profile: { name: string }; wa_id: string }>;
  messages?: WhatsAppMessage[];
  statuses?: any[]; // delivery / read receipts
}

export async function POST(request: NextRequest) {
  try {
    // Read raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");

    if (!(await verifySignature(rawBody, signature))) {
      console.warn("[whatsapp webhook] signature verification failed");
      return new NextResponse("Forbidden", { status: 403 });
    }

    const payload = JSON.parse(rawBody);

    // Process all entries asynchronously, but ALWAYS return 200 fast.
    // Meta retries on non-2xx so failing here = duplicate messages later.
    void processPayload(payload).catch((err) =>
      console.error("[whatsapp webhook] processing error:", err)
    );

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error("[whatsapp webhook] error:", err);
    // Still return 200 to prevent retries on parse errors
    return NextResponse.json({ received: true, error: err?.message });
  }
}

async function processPayload(payload: any) {
  const entries = payload?.entry ?? [];
  for (const entry of entries) {
    const changes = entry?.changes ?? [];
    for (const change of changes) {
      const value: WhatsAppValue = change?.value;
      if (!value) continue;

      // PHASE 5d: identify which tenant this message belongs to BEFORE
      // touching any per-tenant data. Falls back to "no tenant scope" (null)
      // for shared-sender traffic.
      const phoneNumberId = value?.metadata?.phone_number_id || "";
      const tenant = await findTenantByPhoneNumberId(phoneNumberId);

      // Only process inbound messages (skip delivery status receipts)
      const messages = value.messages ?? [];
      for (const msg of messages) {
        await handleInboundMessage(msg, value, tenant);
      }
    }
  }
}

/**
 * Handle a single inbound WhatsApp message, scoped to a specific tenant
 * if we could identify one from the phone_number_id.
 *
 *   1. Parse "1"/"9" — if neither, log to conversation inbox (future) and exit
 *   2. Find a NOTIFIED waitlist entry in this tenant's locations matching the phone
 *   3. Update status, send ack
 */
async function handleInboundMessage(
  msg: WhatsAppMessage,
  _value: WhatsAppValue,
  tenant: { id: string; name: string; displayName: string | null } | null
) {
  const text = (msg.text?.body || msg.button?.text || "").trim();
  const phone = msg.from; // digits only from Meta

  console.log(
    `[whatsapp inbound] tenant=${tenant?.id?.slice(0, 8) || "shared"} from=${phone} text="${text.slice(0, 50)}"`
  );

  // Quick reply parse: "1" = confirm, "9" = cancel
  const isConfirm = text === "1" || /^\s*1\b/.test(text);
  const isCancel = text === "9" || /^\s*9\b/.test(text);

  if (!isConfirm && !isCancel) {
    // Phase 5d-future: log to conversation_messages for admin inbox.
    // For now, just record it so we don't lose context.
    if (tenant) {
      await prisma.conversationMessage.create({
        data: {
          tenantId: tenant.id,
          channel: "WHATSAPP",
          direction: "INBOUND",
          fromPhone: phone,
          toPhone: _value?.metadata?.display_phone_number || "",
          body: text,
          providerMsgId: msg.id,
          rawPayload: _value as any,
        },
      }).catch((err) =>
        console.error("[whatsapp inbound] conversation log failed:", err)
      );
    }
    return;
  }

  // Find a candidate waitlist entry. Scope to this tenant's locations if we
  // know the tenant; otherwise scan globally (shared-sender path).
  const candidates = await prisma.waitlistEntry.findMany({
    where: {
      status: "NOTIFIED",
      smsSentAt: { gte: new Date(Date.now() - 30 * 60_000) }, // 30-min window
      ...(tenant
        ? {
            location: {
              tenantId: tenant.id,
            },
          }
        : {}),
    },
    orderBy: { smsSentAt: "desc" },
    take: 50,
  });

  const matched = candidates.find((e) => normalize(e.customerPhone) === phone);
  if (!matched) {
    console.log(
      `[whatsapp inbound] no matching NOTIFIED waitlist for ${phone} (tenant=${tenant?.id?.slice(0, 8) || "any"})`
    );
    return;
  }

  // Update status
  const newStatus = isConfirm ? "CONFIRMED" : "CANCELLED";
  await prisma.waitlistEntry.update({
    where: { id: matched.id },
    data: {
      status: newStatus,
      smsReplyAt: new Date(),
      smsReplyValue: isConfirm ? "1" : "9",
    },
  });

  // Send acknowledgement back via the same channel
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

  await sendWhatsApp({
    kind: "text",
    tenantId: location.tenant.id,
    to: matched.customerPhone,
    body: ackText,
    category: "waitlist_ack",
  });

  console.log(
    `[whatsapp inbound] waitlist ${matched.id.slice(0, 8)} → ${newStatus} (tenant=${location.tenant.id.slice(0, 8)})`
  );
}

function normalize(phone: string): string {
  return phone.replace(/\D/g, "");
}
