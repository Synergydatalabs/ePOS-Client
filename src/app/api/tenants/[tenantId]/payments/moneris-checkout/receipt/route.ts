// POST /api/tenants/[tenantId]/payments/moneris-checkout/receipt
//
// Called AFTER the Moneris Checkout JS fires the `payment_complete`
// callback on the frontend. We do a server-to-server receipt lookup to
// verify the outcome (never trust the callback alone — it says "complete"
// but not approved/declined; the receipt endpoint is the source of truth).
//
// Body: { ticket: string }
// Returns: { approved, approvalCode, cardType, panMasked, amountCents, ... }
//
// This route intentionally does NOT touch any DB table. Persistence
// (marking an Order paid, writing a Payment row, etc.) is the caller's
// responsibility — they know which internal record the ticket corresponds
// to. 2b will wire this into the supplier-payment-link flow with proper
// idempotent persistence.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import {
  fetchReceipt,
  getMcoCredentialsFromEnv,
  McoApiError,
} from "@/lib/moneris-checkout";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const body = await request.json().catch(() => ({}));
  const { ticket } = body as { ticket?: string };
  if (!ticket || typeof ticket !== "string") {
    return NextResponse.json({ error: "ticket is required" }, { status: 400 });
  }

  let credentials;
  try {
    credentials = getMcoCredentialsFromEnv();
  } catch (err) {
    return NextResponse.json(
      { error: `MCO credentials not configured: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  try {
    const result = await fetchReceipt({ credentials, ticket });
    return NextResponse.json({
      success: true,
      provider: "MONERIS_CHECKOUT",
      approved: result.approved,
      declined: result.declined,
      message: result.message,
      approvalCode: result.approvalCode,
      cardType: result.cardType,
      panMasked: result.panMasked,
      amountCents: result.amountCents,
      orderNo: result.orderNo,
      transactionNo: result.transactionNo,
      responseCode: result.responseCode,
    });
  } catch (err) {
    if (err instanceof McoApiError) {
      console.error("[MCO RECEIPT] Moneris API error", {
        message: err.message,
        raw: err.raw,
      });
      return NextResponse.json(
        { error: `Moneris rejected the receipt lookup: ${err.message}` },
        { status: 502 }
      );
    }
    console.error("[MCO RECEIPT] Unexpected error", err);
    return NextResponse.json(
      { error: (err as Error).message || "Receipt lookup failed" },
      { status: 500 }
    );
  }
}
