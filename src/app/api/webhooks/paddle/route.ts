// POST /api/webhooks/paddle
//
// Paddle delivers transaction lifecycle events here. We only act on
// `transaction.completed` — a successful capture — and mark the
// matching SupplierInvoice as PAID. Idempotent: a replay against an
// already-paid invoice is a no-op and still 200s so Paddle doesn't
// retry.
//
// Signature verification uses the raw request body (bytes-exact).
// Rejecting a signature returns 400 with no detail — don't give an
// attacker a probing surface.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyPaddleSignature } from "@/lib/paddle/webhook";

export async function POST(request: NextRequest) {
  // Read the raw body FIRST — HMAC is over the exact bytes Paddle sent,
  // not a re-serialized JSON object.
  const rawBody = await request.text();
  const sigHeader = request.headers.get("paddle-signature");

  const verify = verifyPaddleSignature(rawBody, sigHeader);
  if (!verify.ok) {
    console.warn("[PADDLE-WEBHOOK] signature rejected:", verify.reason);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const eventType: string = event?.event_type || event?.eventType || "";
  const data = event?.data || {};

  // We only act on completion. Everything else — created, updated,
  // past_due, etc. — gets a 200 so Paddle stops redelivering.
  if (eventType !== "transaction.completed") {
    return NextResponse.json({ ok: true, ignored: eventType });
  }

  const invoiceId: string | undefined =
    data?.custom_data?.hub_invoice_id || data?.customData?.hub_invoice_id;
  const txnId: string | undefined = data?.id;

  if (!invoiceId && !txnId) {
    console.warn("[PADDLE-WEBHOOK] completion event missing invoice id + txn id");
    return NextResponse.json({ ok: true, skipped: "no_identifier" });
  }

  // Prefer the custom_data invoice id (what we set at mint time).
  // Fall back to the Paddle transaction id we stored on the invoice.
  const invoice = invoiceId
    ? await prisma.supplierInvoice.findUnique({ where: { id: invoiceId } })
    : await prisma.supplierInvoice.findFirst({ where: { paymentLinkRef: txnId } });

  if (!invoice) {
    console.warn("[PADDLE-WEBHOOK] no matching invoice:", { invoiceId, txnId });
    return NextResponse.json({ ok: true, skipped: "no_match" });
  }

  // Idempotent — already-paid rows are a no-op.
  if (invoice.paymentStatus === "PAID") {
    return NextResponse.json({ ok: true, alreadyPaid: true });
  }

  // Figure out the actual method the customer used — "kakao_pay",
  // "card", "paypal", etc. — so the dashboard shows what Paddle
  // actually charged.
  const methodType: string =
    data?.payments?.[0]?.method_details?.type ||
    data?.payments?.[0]?.methodDetails?.type ||
    "paddle";

  const amountPaidCents = Number(data?.details?.totals?.total ?? invoice.totalCents) || invoice.totalCents;

  await prisma.supplierInvoice.update({
    where: { id: invoice.id },
    data: {
      paymentStatus: "PAID",
      status: "PAID",
      paidAt: new Date(),
      paidMethod: `paddle_${methodType}`.slice(0, 60),
      amountPaidCents,
      paymentLinkRef: txnId || invoice.paymentLinkRef,
    },
  });

  console.log(
    `[PADDLE-WEBHOOK] invoice ${invoice.id} marked PAID via ${methodType} (txn ${txnId})`
  );

  return NextResponse.json({ ok: true, paid: true });
}
