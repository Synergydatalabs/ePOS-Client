// POST /api/pay/po/[poId]/moneris/preload
// Public — no auth. Called from the /pay/po/[poId] page when the payer
// lands and the PO's processor is MONERIS. Mints a fresh Moneris Checkout
// ticket for THIS visit; the frontend then loads chkt_v1.00.js and calls
// monerisCheckout.startCheckout(ticket).
//
// Gating (same as mock-pay):
//   • Payer must present ?ref=<paymentLinkReference> in the body
//   • ref + poId must both match the PO row — otherwise 404
//   • Link must not be expired
//   • PO must not already be PAID (returns 409 so the frontend can pivot
//     to the "already paid" view instead of double-charging)
//
// Credentials strategy for 2b: env-var platform MCO creds. Per-supplier
// creds land in 2d, at which point this route reads SupplierProcessor
// instead of the env fallback — same function signature, no downstream
// changes needed.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { createPreload, getMcoCredentialsFromEnv, McoApiError } from "@/lib/moneris-checkout";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ poId: string }> }
) {
  try {
    const { poId } = await params;
    const body = await request.json().catch(() => ({}));
    const ref = String(body.ref || "").trim();
    if (!ref) return NextResponse.json({ error: "Missing reference" }, { status: 400 });

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: poId, paymentLinkReference: ref },
      select: {
        id: true,
        poNumber: true,
        totalCents: true,
        currency: true,
        paymentStatus: true,
        paymentLinkExpiresAt: true,
        paymentLinkReference: true,
        supplierTenant: {
          select: {
            name: true,
            supplierProfile: { select: { displayName: true } },
          },
        },
      },
    });
    if (!po) return NextResponse.json({ error: "Invalid payment link" }, { status: 404 });

    if (po.paymentStatus === "PAID") {
      return NextResponse.json(
        { error: "This purchase order has already been paid.", code: "ALREADY_PAID" },
        { status: 409 }
      );
    }
    if (po.paymentLinkExpiresAt && po.paymentLinkExpiresAt < new Date()) {
      return NextResponse.json(
        { error: "This payment link has expired." },
        { status: 410 }
      );
    }

    // Load MCO credentials. 2b uses platform env vars; 2d will read
    // SupplierProcessor.credentialsEnc for the supplier that owns this PO
    // and fall back to env only when the supplier hasn't configured MCO
    // yet. The function signature here doesn't need to change for that.
    let credentials;
    try {
      credentials = getMcoCredentialsFromEnv();
    } catch (err) {
      console.error("[MCO-PRELOAD] Credentials missing:", err);
      return NextResponse.json(
        { error: "Moneris Checkout is not configured on this environment." },
        { status: 503 }
      );
    }

    const supplierName =
      po.supplierTenant.supplierProfile?.displayName || po.supplierTenant.name;

    // Moneris rejects a repeated order_no on the same store — even if the
    // prior transaction was never completed. Any customer who opens the
    // link twice (page refresh, back-button, retry-after-cancel) needs a
    // fresh orderNo. We append a millisecond suffix per preload so it's
    // always unique. The linkage back to the PO uses the URL `ref` (which
    // matches payment_link_reference) + Moneris's `ticket` in verify —
    // not the orderNo itself — so making it unique per attempt is safe.
    const baseRef =
      po.paymentLinkReference || `PO-${po.id.slice(0, 8).toUpperCase()}`;
    const uniqueOrderNo = `${baseRef}-${Date.now().toString().slice(-8)}`;

    const result = await createPreload({
      credentials,
      amountCents: po.totalCents,
      orderNo: uniqueOrderNo,
      dynamicDescriptor: `${po.poNumber}`.slice(0, 22),
      // No cart object — MCO renders a broken-image icon when cart items
      // lack a `url` field, and we don't have per-item product photos to
      // supply for a PO. The Order Summary section is enough context:
      // shows the total, and the PO number is already visible via the
      // dynamicDescriptor + return page. Nicer visuals without the
      // ugly broken-image placeholder.
    });
    // supplierName is intentionally unused in this preload — see cart
    // note above. Referenced here to keep the linter quiet if we later
    // reintroduce the cart with real product images.
    void supplierName;

    return NextResponse.json({
      success: true,
      ticket: result.ticket,
      scriptUrl: result.scriptUrl,
      environment: result.environment,
    });
  } catch (err) {
    if (err instanceof McoApiError) {
      console.error("[MCO-PRELOAD] Moneris rejected preload", {
        message: err.message,
        raw: err.raw,
      });
      return NextResponse.json(
        { error: `Moneris rejected the preload: ${err.message}` },
        { status: 502 }
      );
    }
    console.error("[MCO-PRELOAD] Unexpected error", err);
    return NextResponse.json(
      { error: (err as Error).message || "Preload failed" },
      { status: 500 }
    );
  }
}
