// POST /api/webhooks/payment/gp
// Global Payments payment-capture webhook.
//
// Auth: HMAC-SHA256 signature in the `X-GP-Signature` header, verified
// against GP_WEBHOOK_SECRET (env var). If verification fails we return 401
// so GP knows to retry (they'll assume transient config issue).
//
// Body shape: TENTATIVE. Real GP webhook format hasn't been nailed down yet
// (needs the conversation with GP's onboarding team first). Until then we
// accept a defensive shape that pulls the transaction reference + amount
// from several plausible field locations. When the real shape is known,
// this parser tightens up.
//
// Uses the same markPoAsPaid() helper the mock endpoint uses — the state
// transition + notifications live in one place, both paths behave the same.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyHmacSignature } from "@/lib/payment-webhook-verify";
import { markPoAsPaid } from "@/lib/marketplace-po-payment";

export async function POST(request: NextRequest) {
  try {
    // Read raw body BEFORE parsing — required for signature verification
    // (we hash the exact bytes GP sent, not our re-serialized JSON).
    const rawBody = await request.text();

    // Signature verification. In v1 we use a single global secret; a
    // per-supplier secret can be introduced later by pulling from
    // TenantPaymentProvider.credentialsEnc once we know GP's format.
    const secret = process.env.GP_WEBHOOK_SECRET;
    if (!secret) {
      console.error("[WEBHOOK-GP] GP_WEBHOOK_SECRET not configured — rejecting all webhooks");
      return NextResponse.json(
        { error: "Webhook processing not configured on this environment" },
        { status: 503 }
      );
    }

    const signature =
      request.headers.get("x-gp-signature") ||
      request.headers.get("X-GP-Signature") ||
      request.headers.get("x-signature");
    if (!verifyHmacSignature({ rawBody, secret, providedSignature: signature })) {
      console.warn("[WEBHOOK-GP] Bad or missing signature — rejecting");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    // Parse body — after signature check, so we don't waste CPU on
    // untrusted payloads.
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Extract event type and pull out the transaction reference + amount.
    // Real GP will have specific field names — we accept several common
    // locations so the endpoint doesn't 400 while we're finalizing the
    // integration.
    const eventType =
      payload?.event_type || payload?.type || payload?.event || null;

    // Only handle capture / success events. Everything else (auth-only,
    // pending, refund, dispute) is acknowledged but ignored for v1 —
    // add branches as we need them.
    const isCaptured =
      typeof eventType === "string" &&
      /^(payment|transaction)\.(captured|succeeded|success)$/i.test(eventType);
    if (!isCaptured) {
      console.log(
        `[WEBHOOK-GP] Ignoring event type "${eventType}" — no PO transition triggered`
      );
      return NextResponse.json({ success: true, ignored: true });
    }

    // Reference — try a few common paths. Real GP field name is TBD;
    // update this to a single canonical location once we know.
    const reference =
      payload?.reference ||
      payload?.data?.reference ||
      payload?.transaction?.reference ||
      payload?.data?.id ||
      payload?.id ||
      null;
    if (!reference || typeof reference !== "string") {
      console.error("[WEBHOOK-GP] Could not extract reference from body:", payload);
      return NextResponse.json(
        { error: "Missing transaction reference" },
        { status: 400 }
      );
    }

    // Amount — same defensive extraction. Real GP will normalize.
    const amountFromBody: number | null =
      typeof payload?.amount_cents === "number"
        ? payload.amount_cents
        : typeof payload?.data?.amount_cents === "number"
        ? payload.data.amount_cents
        : typeof payload?.amount === "number"
        ? // GP historically sends amount in dollars — treat as such if
          // it's a floating-point number, cents if integer. Best-effort
          // until the real shape is confirmed.
          Number.isInteger(payload.amount) && payload.amount > 1000
          ? payload.amount
          : Math.round(payload.amount * 100)
        : null;

    const method =
      payload?.payment_method?.entry_mode ||
      payload?.method ||
      payload?.data?.payment_method?.entry_mode ||
      "card";

    // Look up the PO by the processor's reference — this is the index
    // we added in the schema migration for exactly this path.
    const po = await prisma.purchaseOrder.findFirst({
      where: { paymentLinkReference: reference },
      select: { id: true, poNumber: true, totalCents: true, paymentStatus: true },
    });
    if (!po) {
      // Return 200 anyway — a 4xx would make GP retry a stale webhook
      // forever. Log and move on; this is usually a webhook for a PO
      // that was deleted or is on a different environment.
      console.warn(
        `[WEBHOOK-GP] No PO found for reference "${reference}" — acknowledging + ignoring`
      );
      return NextResponse.json({ success: true, ignored: true, reason: "unknown_reference" });
    }

    // If amount is missing from the body, fall back to the PO's total.
    // Safe because the PO is the authoritative source of what the merchant
    // was charged for.
    const paidAmountCents = amountFromBody ?? po.totalCents;

    const result = await markPoAsPaid({
      purchaseOrderId: po.id,
      paidAmountCents,
      paidMethod: String(method).slice(0, 50),
      processorReference: reference,
    });

    console.log(
      `[WEBHOOK-GP] ${result.wasFreshTransition ? "captured" : "idempotent"} for PO ${result.purchaseOrder.poNumber} (ref=${reference})`
    );

    return NextResponse.json({ success: true, wasFreshTransition: result.wasFreshTransition });
  } catch (error: any) {
    console.error("[WEBHOOK-GP] error:", error);
    // Return 500 — GP will retry; hopefully whatever caused the error is
    // transient. A bug would keep hitting this, which is loud in logs
    // (the way we want).
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}
