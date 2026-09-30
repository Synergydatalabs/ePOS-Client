// POST /api/pay/po/[poId]/moneris/verify
// Public — no auth. Called from the /pay/po/[poId] page after Moneris
// Checkout fires its `payment_complete` callback. We NEVER trust the
// client's claim that payment succeeded — this endpoint does a
// server-to-server receipt lookup via the MCO API, then (on approval)
// marks the PO as paid via the shared markPoAsPaid() helper.
//
// Gating (same as preload):
//   • Payer must present ?ref=<paymentLinkReference>
//   • ref + poId must match the PO row — otherwise 404
//   • ticket is the one Moneris returned to the frontend from preload
//
// Idempotent — markPoAsPaid short-circuits when the PO is already PAID.
// So a double-fire of the callback (browser back button, retries, etc.)
// doesn't cause duplicate notifications or ledger entries.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { markPoAsPaid } from "@/lib/marketplace-po-payment";
import { fetchReceipt, getMcoCredentialsFromEnv, McoApiError } from "@/lib/moneris-checkout";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ poId: string }> }
) {
  try {
    const { poId } = await params;
    const body = await request.json().catch(() => ({}));
    const ref = String(body.ref || "").trim();
    const ticket = String(body.ticket || "").trim();
    if (!ref) return NextResponse.json({ error: "Missing reference" }, { status: 400 });
    if (!ticket) return NextResponse.json({ error: "Missing ticket" }, { status: 400 });

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: poId, paymentLinkReference: ref },
      select: { id: true, poNumber: true, totalCents: true, paymentStatus: true },
    });
    if (!po) return NextResponse.json({ error: "Invalid payment link" }, { status: 404 });

    // Fast path — if already PAID, just return the current status. The
    // Moneris callback often fires twice (once when Moneris finishes,
    // again when the user closes the widget) and we don't want to hit
    // Moneris's receipt endpoint on the second call.
    if (po.paymentStatus === "PAID") {
      return NextResponse.json({
        success: true,
        alreadyPaid: true,
        paymentStatus: "PAID",
      });
    }

    let credentials;
    try {
      credentials = getMcoCredentialsFromEnv();
    } catch (err) {
      console.error("[MCO-VERIFY] Credentials missing:", err);
      return NextResponse.json(
        { error: "Moneris Checkout is not configured on this environment." },
        { status: 503 }
      );
    }

    // Server-to-server receipt lookup — the source of truth for the
    // transaction outcome. The JS `payment_complete` callback only means
    // "the widget closed"; approved vs declined only comes from here.
    const receipt = await fetchReceipt({ credentials, ticket });

    if (!receipt.approved) {
      console.log(
        `[MCO-VERIFY] PO ${po.poNumber} not approved (statusCode=${receipt.responseCode}, ${receipt.message})`
      );
      return NextResponse.json({
        success: false,
        approved: false,
        message: receipt.message,
        responseCode: receipt.responseCode,
      });
    }

    // Approved — persist. amountCents from receipt matches what MCO
    // captured; usually equals po.totalCents but Moneris is the source
    // of truth on the actual charged amount.
    const result = await markPoAsPaid({
      purchaseOrderId: po.id,
      paidAmountCents: receipt.amountCents ?? po.totalCents,
      paidMethod: `moneris-checkout${receipt.cardType ? `-${receipt.cardType.toLowerCase()}` : ""}`,
      processorReference: receipt.transactionNo ?? ticket,
    });

    console.log(
      `[MCO-VERIFY] PO ${result.purchaseOrder.poNumber} ${
        result.wasFreshTransition ? "APPROVED" : "already paid (idempotent)"
      } via MCO (auth ${receipt.approvalCode})`
    );

    return NextResponse.json({
      success: true,
      approved: true,
      paymentStatus: result.purchaseOrder.paymentStatus,
      wasFreshTransition: result.wasFreshTransition,
      approvalCode: receipt.approvalCode,
      cardType: receipt.cardType,
      panMasked: receipt.panMasked,
    });
  } catch (err) {
    if (err instanceof McoApiError) {
      console.error("[MCO-VERIFY] Moneris rejected receipt lookup", {
        message: err.message,
        raw: err.raw,
      });
      return NextResponse.json(
        { error: `Moneris receipt lookup failed: ${err.message}` },
        { status: 502 }
      );
    }
    console.error("[MCO-VERIFY] Unexpected error", err);
    return NextResponse.json(
      { error: (err as Error).message || "Verification failed" },
      { status: 500 }
    );
  }
}
