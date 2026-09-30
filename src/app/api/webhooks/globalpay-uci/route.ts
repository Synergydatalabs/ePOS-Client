// POST /api/webhooks/globalpay-uci
// Receives Device Command result callbacks from Global Payments UCI.
//
// GP posts here after a device command finishes (paid, cancelled, declined,
// expired). Payload shape per GP UCI docs:
//
// {
//   id:               "DVC_xxxxxxxx",       // Device Command ID
//   device_reference: "uds_123456789",      // The terminal that completed it
//   action_type:      "TRANSACTION_LIST",   // What kind of command it was
//   status:           "COMPLETED",          // INITIATED|COMPLETED|FAILED|CANCELLED|...
//   transaction:      [ { id: "TRN_xxx", amount: "...", payment_method: {...} } ],
//   action: { result_code: "SUCCESS", ... }
// }
//
// Signature: GP signs each request with HMAC; we verify via X-GP-Signature.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyUciWebhook } from "@/lib/gp-uci";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature =
    request.headers.get("x-gp-signature") ||
    request.headers.get("X-GP-Signature") ||
    null;

  // Verify HMAC signature unless we don't yet have the webhook secret
  // configured (in cert/dev). In production GLOBALPAY_UCI_WEBHOOK_SECRET
  // must be set or all callbacks are rejected.
  const hasSecret = !!process.env.GLOBALPAY_UCI_WEBHOOK_SECRET;
  if (hasSecret) {
    const valid = verifyUciWebhook(rawBody, signature);
    if (!valid) {
      console.warn("[UCI WEBHOOK] Signature verification failed");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  } else {
    console.warn(
      "[UCI WEBHOOK] No GLOBALPAY_UCI_WEBHOOK_SECRET set — accepting unsigned webhook (cert mode only)"
    );
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // The result envelope GP sends matches the Device Command response
  const dvcId: string | undefined = event.id;
  const deviceReference: string | undefined = event.device_reference;
  const actionType: string | undefined = (event.action_type || "").toUpperCase();
  const rawStatus: string = (event.status || "").toUpperCase();
  const txnArray: any[] = Array.isArray(event.transaction)
    ? event.transaction
    : [];
  const firstTxn = txnArray[0] || null;

  if (!dvcId) {
    console.warn("[UCI WEBHOOK] No DVC id in payload — ignoring", { event });
    return NextResponse.json({ received: true, ignored: true });
  }

  // Map GP status → our internal bill status
  let billStatus:
    | "PAID"
    | "CANCELLED"
    | "FAILED"
    | "EXPIRED"
    | "DELIVERED"
    | "SENT"
    | null = null;

  if (
    rawStatus === "COMPLETED" &&
    (actionType === "AUTHORIZE" || actionType === "CAPTURE" || actionType === "TRANSACTION_LIST")
  ) {
    billStatus = firstTxn ? "PAID" : "DELIVERED";
  } else if (rawStatus === "COMPLETED" && actionType === "CREATE_ORDER") {
    billStatus = "DELIVERED";
  } else if (rawStatus === "COMPLETED" && actionType === "DELETE_ORDER") {
    billStatus = "CANCELLED";
  } else if (rawStatus.includes("CANCEL") || rawStatus === "DELETED") {
    billStatus = "CANCELLED";
  } else if (rawStatus.includes("FAIL") || rawStatus.includes("DECLIN")) {
    billStatus = "FAILED";
  } else if (rawStatus.includes("EXPIR") || rawStatus.includes("TIMEOUT")) {
    billStatus = "EXPIRED";
  } else if (rawStatus === "INITIATED" || rawStatus === "PENDING") {
    billStatus = "SENT";
  }

  if (!billStatus) {
    console.log("[UCI WEBHOOK] Unrecognized status — recording as raw", {
      dvcId,
      rawStatus,
      actionType,
    });
    billStatus = "DELIVERED"; // safe default — keep in flight
  }

  console.log(`[UCI WEBHOOK] ${actionType} → ${billStatus} (DVC=${dvcId}, lane=${deviceReference})`);

  // Find the matching bill row by DVC_Id
  const bills: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, tenant_id, order_id, status FROM uci_bills
     WHERE gp_bill_id = $1 LIMIT 1`,
    dvcId
  );

  if (bills.length === 0) {
    console.warn("[UCI WEBHOOK] DVC not found in DB:", dvcId);
    return NextResponse.json({ received: true, billNotFound: true });
  }

  const bill = bills[0];

  // Idempotency — skip if already in this terminal state
  if (
    ["PAID", "CANCELLED", "FAILED", "EXPIRED"].includes(bill.status) &&
    bill.status === billStatus
  ) {
    return NextResponse.json({ received: true, idempotent: true });
  }

  // Pull transaction details if present
  const card = firstTxn?.payment_method?.card;
  const tipAmount = firstTxn?.gratuity_amount
    ? Number(firstTxn.gratuity_amount)
    : undefined;
  const authCode = card?.auth_code;
  const cardLast4 =
    card?.masked_number_last4 && card.masked_number_last4.replace(/[^0-9]/g, "").slice(-4);
  const cardBrand = card?.brand;
  const entryMode = firstTxn?.payment_method?.entry_mode;
  const transactionId = firstTxn?.id;

  // Update bill row
  const setClauses: string[] = [
    "status = $1",
    "response_payload = $2::jsonb",
    "updated_at = NOW()",
  ];
  const vals: any[] = [billStatus, JSON.stringify(event)];
  let i = 3;

  if (tipAmount !== undefined) {
    setClauses.push(`tip_amount = $${i++}`);
    vals.push(tipAmount);
  }
  if (authCode) {
    setClauses.push(`auth_code = $${i++}`);
    vals.push(authCode);
  }
  if (cardLast4) {
    setClauses.push(`card_last4 = $${i++}`);
    vals.push(cardLast4);
  }
  if (cardBrand) {
    setClauses.push(`card_brand = $${i++}`);
    vals.push(cardBrand);
  }
  if (entryMode) {
    setClauses.push(`entry_mode = $${i++}`);
    vals.push(entryMode);
  }
  if (transactionId) {
    setClauses.push(`gp_transaction_id = $${i++}`);
    vals.push(transactionId);
  }
  if (billStatus === "PAID") setClauses.push(`paid_at = NOW()`);
  if (billStatus === "CANCELLED") setClauses.push(`cancelled_at = NOW()`);
  if (billStatus === "DELIVERED") setClauses.push(`delivered_at = NOW()`);

  vals.push(bill.id);
  await prisma.$queryRawUnsafe(
    `UPDATE uci_bills SET ${setClauses.join(", ")} WHERE id = $${i}::uuid`,
    ...vals
  );

  // Mark linked order paid on success.
  //
  // Two bugs were making this branch silently fail — that's why every
  // terminal payment stayed at "Pending payment" in the UI:
  //   1. paymentStatus: "PAID" is invalid — PaymentStatus enum uses
  //      COMPLETED. "PAID" belongs to BillingInvoiceStatus, a totally
  //      different table. Prisma threw, the catch below swallowed it.
  //   2. The order was never given a Payment row, so the POS split-
  //      tender logic (which computes `outstanding = total −
  //      sum(completed payments)`) still saw the order as owing full.
  //
  // Fix both in one transaction so partial success can't leave the
  // order half-updated.
  if (billStatus === "PAID" && bill.order_id) {
    try {
      // Load currency to stamp on the Payment row (Payment.currency is
      // required; must match the order).
      const orderRow = await prisma.order.findUnique({
        where: { id: bill.order_id },
        select: { total: true, currency: true, tipAmount: true },
      });
      const paymentAmount = firstTxn?.amount
        ? Number(firstTxn.amount)
        : orderRow?.total ?? 0;

      await prisma.$transaction([
        prisma.payment.create({
          data: {
            orderId: bill.order_id,
            provider: "gp_uci",
            method: "card",
            amount: paymentAmount,
            currency: orderRow?.currency || "CAD",
            status: "COMPLETED",
            completedAt: new Date(),
            metadata: {
              source: "gp_uci_terminal",
              dvcId,
              transactionId: transactionId || null,
              cardBrand: cardBrand || null,
              cardLast4: cardLast4 || null,
              entryMode: entryMode || null,
              authCode: authCode || null,
            },
          },
        }),
        prisma.order.update({
          where: { id: bill.order_id },
          data: {
            paymentStatus: "COMPLETED",
            paymentMethod: "CARD",
            paidAt: new Date(),
            // Preserve existing tip if we didn't get one on this txn.
            ...(tipAmount && tipAmount > 0 && { tipAmount }),
            // If the order was still sitting at NEW/PENDING_PAYMENT,
            // move it to CONFIRMED so kitchen/appointment boards pick
            // it up. Don't regress a further-along status.
          },
        }),
      ]);
      console.log(
        `[UCI WEBHOOK] Order ${bill.order_id} marked COMPLETED + Payment row created`
      );
    } catch (err) {
      console.error("[UCI WEBHOOK] Failed to mark order paid:", err);
    }
  }

  return NextResponse.json({ received: true, billStatus });
}

// Some webhook providers verify the URL with a GET first
export async function GET() {
  return NextResponse.json({ service: "globalpay-uci-webhook", status: "ready" });
}
