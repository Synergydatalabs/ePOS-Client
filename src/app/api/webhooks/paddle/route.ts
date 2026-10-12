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
import { apiAmountToInternalCents } from "@/lib/currency/zero-decimal";

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

  // 2026-10-12: payout events — withdrawals from the Paddle balance.
  // Fire the KakoTotal notifier so the ops group sees balance movements.
  // Subscribe to `payout.created` + `payout.paid` in the Paddle dashboard
  // to receive these; without the subscription, Paddle won't call us.
  if (eventType === "payout.created" || eventType === "payout.paid") {
    try {
      const { notifyKakaoTotal } = await import("@/lib/telegram-notify");
      const { apiAmountToInternalCents } = await import("@/lib/currency/zero-decimal");
      const payoutCurrency = String(data?.currency_code || data?.currencyCode || "KRW").toUpperCase();
      const payoutRaw = Number(data?.amount ?? data?.totals?.total ?? 0);
      const payoutInternalCents = apiAmountToInternalCents(payoutRaw, payoutCurrency);
      void notifyKakaoTotal({
        kind: "payout",
        amountCents: payoutInternalCents,
        currency: payoutCurrency,
        payoutStatus: eventType === "payout.paid" ? "paid" : "created",
        payoutId: String(data?.id || ""),
        occurredAt: new Date(),
      });
    } catch (err) {
      console.warn("[PADDLE-WEBHOOK] payout notify failed (continuing):", err);
    }
    return NextResponse.json({ ok: true, payout: eventType });
  }

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

  // Paddle sends `total` in minor units — same as major for zero-decimal
  // currencies (KRW/JPY/VND/…). Normalise to our internal "always ×100"
  // convention so stored amounts match what the DB expects for formatting.
  const paddleRawTotal = Number(data?.details?.totals?.total ?? invoice.totalCents) || invoice.totalCents;
  const amountPaidCents = apiAmountToInternalCents(paddleRawTotal, invoice.currency);

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

  // 2026-10-11: fire Telegram notification. Routes to the KakaoPay bot
  // when method is kakao_pay; everything else goes to the default bot.
  //
  // 2026-10-12: ALSO fire KakoTotal notification with running total of all
  // paid Paddle Kakao payments in this currency. Separate bot/group so
  // ops can watch balance movements without the per-transaction noise.
  try {
    const { notifyInvoicePaid, notifyKakaoTotal } = await import("@/lib/telegram-notify");
    const freshInvoice = await prisma.supplierInvoice.findUnique({
      where: { id: invoice.id },
      select: {
        invoiceNumber: true,
        customerEmail: true,
      },
    });
    if (freshInvoice) {
      void notifyInvoicePaid({
        invoiceNumber: freshInvoice.invoiceNumber,
        amountCents: amountPaidCents,
        currency: invoice.currency,
        processor: "Paddle",
        method: methodType,
        transactionId: txnId || null,
        customerEmail: freshInvoice.customerEmail,
        paidAt: new Date(),
      });

      // Compute running total for THIS currency across all Paddle Kakao
      // paid invoices. Sum from the DB; drift vs Paddle's actual balance
      // is possible if Paddle charges fees not reflected in our rows,
      // but it's close enough for an at-a-glance ops view.
      const isKakao =
        methodType.toLowerCase().includes("kakao") ||
        methodType.toLowerCase() === "kakao_pay";
      if (isKakao) {
        try {
          const sum = await prisma.supplierInvoice.aggregate({
            _sum: { amountPaidCents: true },
            where: {
              paymentStatus: "PAID",
              currency: invoice.currency,
              paidMethod: { startsWith: "paddle_kakao" },
            },
          });
          const runningTotal = sum._sum.amountPaidCents ?? 0;
          void notifyKakaoTotal({
            kind: "payment",
            amountCents: amountPaidCents,
            currency: invoice.currency,
            runningTotalCents: runningTotal,
            invoiceNumber: freshInvoice.invoiceNumber,
            transactionId: txnId || null,
            occurredAt: new Date(),
          });
        } catch (totalErr) {
          console.warn("[PADDLE-WEBHOOK] running-total notify failed:", totalErr);
        }
      }
    }
  } catch (notifyErr) {
    console.warn("[PADDLE-WEBHOOK] telegram notify failed (continuing):", notifyErr);
  }

  return NextResponse.json({ ok: true, paid: true });
}
