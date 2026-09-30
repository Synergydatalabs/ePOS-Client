// GET  /api/tenants/[tenantId]/payments/uci/bill/[billId] — status lookup
// DELETE /api/tenants/[tenantId]/payments/uci/bill/[billId] — cancel

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { cancelBill, getBillStatus } from "@/lib/gp-uci";

type Params = { params: Promise<{ tenantId: string; billId: string }> };

// A bill is stale if it's still in an in-flight state AND older than this
// many milliseconds — we then pull the true status from GP directly
// instead of trusting the local row. Covers the case where the GP webhook
// silently doesn't reach us (broken URL, wrong secret, IAM policy, TLS).
const STALE_THRESHOLD_MS = 8_000;
const IN_FLIGHT_STATUSES = new Set(["SENT", "DELIVERED"]);

/**
 * Mirror of the webhook handler's "mark paid" side. Extracted so both
 * paths (webhook AND polling reconcile) produce identical DB state:
 * uci_bills row set to PAID, Payment row created, Order flipped to
 * COMPLETED. Idempotent — safe to call twice for the same bill.
 */
async function applyPaidTransaction(opts: {
  billId: string;
  orderId: string | null;
  txn: any | null;
  currency: string;
  amountCents: number;
  gpEnvelope: any;
}) {
  const { billId, orderId, txn, currency, amountCents, gpEnvelope } = opts;

  const card = txn?.payment_method?.card;
  const tipAmount = txn?.gratuity_amount ? Number(txn.gratuity_amount) : undefined;
  const authCode = card?.auth_code || null;
  const cardLast4 =
    card?.masked_number_last4 &&
    String(card.masked_number_last4).replace(/[^0-9]/g, "").slice(-4);
  const cardBrand = card?.brand || null;
  const entryMode = txn?.payment_method?.entry_mode || null;
  const transactionId = txn?.id || null;

  // Update uci_bills row (idempotent — repeated update is fine).
  const setClauses = ["status = 'PAID'", "paid_at = COALESCE(paid_at, NOW())", "updated_at = NOW()"];
  const vals: any[] = [];
  let i = 1;
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
  setClauses.push(`response_payload = $${i++}::jsonb`);
  vals.push(JSON.stringify(gpEnvelope || {}));
  vals.push(billId);
  await prisma.$queryRawUnsafe(
    `UPDATE uci_bills SET ${setClauses.join(", ")} WHERE id = $${i}::uuid AND status != 'PAID'`,
    ...vals
  );

  // Mirror the webhook: create a Payment row + mark Order COMPLETED.
  // Skip if we already have a Payment row for this bill (idempotent).
  if (orderId) {
    const alreadyPaid = await prisma.payment.findFirst({
      where: {
        orderId,
        provider: "gp_uci",
        status: "COMPLETED",
        metadata: { path: ["dvcId"], equals: billId } as any,
      },
      select: { id: true },
    }).catch(() => null);

    if (!alreadyPaid) {
      await prisma.$transaction([
        prisma.payment.create({
          data: {
            orderId,
            provider: "gp_uci",
            method: "card",
            amount: amountCents,
            currency,
            status: "COMPLETED",
            completedAt: new Date(),
            metadata: {
              source: "gp_uci_terminal_reconcile",
              dvcId: billId,
              transactionId,
              cardBrand,
              cardLast4,
              entryMode,
              authCode,
            },
          },
        }),
        prisma.order.update({
          where: { id: orderId },
          data: {
            paymentStatus: "COMPLETED",
            paymentMethod: "CARD",
            paidAt: new Date(),
            ...(tipAmount && tipAmount > 0 && { tipAmount }),
          },
        }),
      ]);
      console.log(
        `[UCI BILL RECONCILE] Order ${orderId} marked COMPLETED via polling (webhook was silent)`
      );
    }
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const { tenantId, billId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT b.*, t.name AS terminal_name, t.uci_lane
     FROM uci_bills b
     LEFT JOIN terminals t ON b.terminal_id = t.id
     WHERE b.id = $1::uuid AND b.tenant_id = $2::uuid`,
    billId,
    tenantId
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  let r = rows[0];

  // Reconcile with GP when the local row looks stale — i.e. it's still
  // in an in-flight state and enough time has passed that the customer
  // has almost certainly finished tapping. This is the safety net for
  // when the webhook never arrives (broken URL, cert, IAM, secret).
  const ageMs = r.created_at ? Date.now() - new Date(r.created_at).getTime() : 0;
  const isStale =
    IN_FLIGHT_STATUSES.has(String(r.status || "").toUpperCase()) &&
    ageMs >= STALE_THRESHOLD_MS &&
    r.gp_bill_id;
  if (isStale) {
    try {
      const gp = await getBillStatus(r.gp_bill_id, r.uci_lane || undefined);
      if (gp.status === "PAID") {
        // rawResponse is `unknown`/`{}` in the shared type — this is
        // GP's raw envelope; cast to any for the property drill.
        const raw = gp.rawResponse as any;
        const txn = Array.isArray(raw?.transaction) ? raw.transaction[0] : null;
        await applyPaidTransaction({
          billId: r.id,
          orderId: r.order_id,
          txn,
          currency: r.currency || "CAD",
          amountCents: txn?.amount ? Number(txn.amount) : Number(r.amount || 0),
          gpEnvelope: raw,
        });
        // Re-read the row so the response reflects the reconciled state
        const fresh: any[] = await prisma.$queryRawUnsafe(
          `SELECT b.*, t.name AS terminal_name, t.uci_lane
             FROM uci_bills b
             LEFT JOIN terminals t ON b.terminal_id = t.id
            WHERE b.id = $1::uuid`,
          billId
        );
        if (fresh[0]) r = fresh[0];
      } else if (gp.status === "CANCELLED" || gp.status === "FAILED" || gp.status === "EXPIRED") {
        // Sync a terminal-side terminal state so the polling client
        // stops waiting. We DON'T touch the Order here — no payment
        // happened, POS operator can retry.
        await prisma.$queryRawUnsafe(
          `UPDATE uci_bills SET status = $1, updated_at = NOW(),
             cancelled_at = CASE WHEN $1 = 'CANCELLED' THEN NOW() ELSE cancelled_at END
             WHERE id = $2::uuid AND status IN ('SENT','DELIVERED')`,
          gp.status,
          billId
        );
        r = { ...r, status: gp.status };
      }
      // Any other GP status (still in-flight) → leave local alone,
      // client will keep polling.
    } catch (err: any) {
      // GP unreachable / timeout — don't fail the GET, just return
      // the stale local view so the client keeps polling.
      console.warn(
        `[UCI BILL GET] Reconcile with GP failed for ${billId}:`,
        err?.message || err
      );
    }
  }

  return NextResponse.json({
    bill: {
      id: r.id,
      gpBillId: r.gp_bill_id,
      orderId: r.order_id,
      terminalId: r.terminal_id,
      terminalName: r.terminal_name,
      lane: r.uci_lane,
      amount: r.amount,
      tipAmount: r.tip_amount,
      currency: r.currency,
      status: r.status,
      statusReason: r.status_reason,
      authCode: r.auth_code,
      cardLast4: r.card_last4,
      cardBrand: r.card_brand,
      createdAt: r.created_at,
      paidAt: r.paid_at,
      cancelledAt: r.cancelled_at,
    },
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { tenantId, billId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  // 2026-05-27: GP BILL_DELETE requires both the DVC_Id AND the lane (device
  // reference), so we join terminals to pull the uci_lane along with the bill.
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT b.id, b.gp_bill_id, b.status, t.uci_lane
     FROM uci_bills b
     JOIN terminals t ON b.terminal_id = t.id
     WHERE b.id = $1::uuid AND b.tenant_id = $2::uuid`,
    billId,
    tenantId
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  const bill = rows[0];
  if (["PAID", "CANCELLED"].includes(bill.status)) {
    return NextResponse.json(
      { error: `Cannot cancel bill in ${bill.status} state` },
      { status: 400 }
    );
  }
  if (!bill.uci_lane) {
    return NextResponse.json(
      { error: "Terminal lane missing — cannot route DELETE to GP" },
      { status: 400 }
    );
  }

  try {
    // BILL_DELETE needs (gpBillId, lane) per GP CERT validator
    const gpResp = await cancelBill(bill.gp_bill_id, bill.uci_lane);

    await prisma.$queryRawUnsafe(
      `UPDATE uci_bills SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW(),
         response_payload = $1::jsonb WHERE id = $2::uuid`,
      JSON.stringify(gpResp.rawResponse || {}),
      billId
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[UCI BILL] Cancel error:", error);

    // 2026-05-29: GP returns 500 "This bill cannot be deleted as it is already
    // paid" when a payment already completed on the terminal. That's not a
    // server error on our side — the bill is simply past the cancellable
    // state. Treat it as a clean 409 and sync our DB to PAID so the POS shows
    // the right thing instead of a scary error.
    const msg = String(error?.message || "");
    if (/already paid/i.test(msg)) {
      try {
        await prisma.$queryRawUnsafe(
          `UPDATE uci_bills SET status = 'PAID', paid_at = COALESCE(paid_at, NOW()),
             updated_at = NOW() WHERE id = $1::uuid`,
          billId
        );
      } catch (e) {
        console.error("[UCI BILL] Failed to sync paid status after cancel attempt:", e);
      }
      return NextResponse.json(
        {
          error: "This bill has already been paid and cannot be cancelled.",
          alreadyPaid: true,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: error.message || "Failed to cancel bill" },
      { status: 500 }
    );
  }
}
