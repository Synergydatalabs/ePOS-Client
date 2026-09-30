// POST /api/tenants/[tenantId]/orders/[orderId]/payment/void
//
// Voids (reverses) a same-day payment before batch close. For card payments
// this calls GP UCI's REVERSE action against the TRN we recorded when the
// AUTHORIZE landed; for cash/online it just flips the local Payment record
// because there's nothing to undo at GP. After a successful void the Payment
// is marked CANCELLED and the Order's payment status rolls back to UNPAID.
//
// The POS history page already calls this endpoint (handleVoid in
// pos/history/page.tsx). Until this file existed it was 404'ing, which made
// the "Void" button silently fail.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { reverseTransaction } from "@/lib/gp-uci";

type Params = { params: Promise<{ tenantId: string; orderId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { tenantId, orderId } = await params;

  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const body = await request.json().catch(() => ({}));
  const { paymentId, reason } = body as { paymentId?: string; reason?: string };

  if (!paymentId) {
    return NextResponse.json(
      { error: "paymentId is required" },
      { status: 400 }
    );
  }

  // Confirm the payment belongs to this order in this tenant. We pull the
  // full row in one go so we can branch on method/status without a second
  // query.
  const payment = await prisma.payment.findFirst({
    where: {
      id: paymentId,
      orderId,
      order: { location: { tenantId } },
    },
    select: {
      id: true,
      provider: true,
      method: true,
      status: true,
      amount: true,
      providerRef: true,
      orderId: true,
    },
  });

  if (!payment) {
    return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  }

  if (payment.status === "CANCELLED") {
    return NextResponse.json(
      { error: "Payment is already voided" },
      { status: 409 }
    );
  }
  if (payment.status === "REFUNDED" || payment.status === "PARTIALLY_REFUNDED") {
    return NextResponse.json(
      {
        error:
          "Payment already has a refund recorded. Use the refund flow to add to it.",
      },
      { status: 409 }
    );
  }
  if (payment.status !== "COMPLETED") {
    return NextResponse.json(
      { error: `Cannot void a payment in ${payment.status} state` },
      { status: 400 }
    );
  }

  // Card payments go through GP REVERSE. Cash / online don't have a remote
  // counterpart — we just flip the local row. We treat anything that isn't
  // explicitly cash/online as card-flavoured so we don't accidentally skip a
  // legitimate GP void (e.g. method recorded as "interac").
  const method = (payment.method || payment.provider || "").toLowerCase();
  const isLocalOnly = method === "cash" || method === "online";

  let gpReverseResponse: unknown = null;

  if (!isLocalOnly) {
    // Pull the GP TRN_Id + lane from the terminal_transactions row that was
    // written when the AUTHORIZE landed. The lane is needed because REVERSE,
    // like every device command, is scoped to a terminal device_reference.
    const txnRows: Array<{
      gp_transaction_id: string | null;
      uci_lane: string | null;
    }> = await prisma.$queryRawUnsafe(
      `SELECT tt.gp_transaction_id, t.uci_lane
         FROM terminal_transactions tt
         LEFT JOIN terminals t ON tt.terminal_id = t.id
        WHERE tt.payment_id = $1::uuid
          AND tt.gp_transaction_id IS NOT NULL
        ORDER BY tt.sent_at DESC
        LIMIT 1`,
      paymentId
    );

    const trnId = txnRows[0]?.gp_transaction_id;
    const lane = txnRows[0]?.uci_lane;

    if (!trnId || !lane) {
      // Fall back to payment.providerRef if a card payment landed via a
      // non-terminal path (e.g. an older flow that stored only providerRef).
      // If even that's empty we genuinely don't know what to reverse.
      const fallbackTrn = payment.providerRef || null;
      if (!fallbackTrn) {
        return NextResponse.json(
          {
            error:
              "No GP transaction reference recorded for this payment — cannot reverse remotely.",
          },
          { status: 422 }
        );
      }
      if (!lane) {
        return NextResponse.json(
          {
            error:
              "Terminal lane is missing for this payment — cannot route REVERSE to GP.",
          },
          { status: 422 }
        );
      }
    }

    try {
      const gpResp = await reverseTransaction(
        lane!,
        trnId || (payment.providerRef as string)
      );
      gpReverseResponse = gpResp.rawResponse;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[PAYMENT VOID] GP REVERSE failed:", message);

      // GP cloud has been returning empty bodies on REVERSE for our test
      // merchant — see open item in UCI cert submission. We surface that
      // distinctly so the operator knows it's a GP-side capability issue
      // and not a generic failure they should retry blindly.
      const isEmptyBody =
        /empty.*body|reverse.*not.*enabled|REVERSE_DISABLED/i.test(message);
      return NextResponse.json(
        {
          error: isEmptyBody
            ? "GP returned no response — REVERSE may not be enabled on this merchant. Try Refund instead."
            : `GP REVERSE failed: ${message}`,
          source: "gp",
        },
        { status: 502 }
      );
    }
  }

  // Local-side updates: flip Payment → CANCELLED, roll the Order's payment
  // status back to UNPAID, append a metadata note so we can trace it later.
  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "CANCELLED",
        failureReason: reason || "Voided by POS staff",
        metadata: {
          voidedAt: new Date().toISOString(),
          voidedBy: auth.context.membership.id,
          voidedReason: reason || null,
          gpReverseResponse: gpReverseResponse ?? null,
          localOnly: isLocalOnly,
        },
      },
    });

    await tx.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: "UNPAID",
      },
    });

    return p;
  });

  return NextResponse.json({
    success: true,
    payment: {
      id: updated.id,
      status: updated.status,
      method: updated.method,
      voidedRemotely: !isLocalOnly,
    },
  });
}
