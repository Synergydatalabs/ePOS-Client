// POST /api/tenants/[tenantId]/payments/moneris-checkout/preload
//
// Server-to-server call to Moneris that mints a checkout ticket for a
// specific amount + order. The ticket is single-use and short-lived —
// the frontend passes it to monerisCheckout.startCheckout(ticket) to
// render the hosted card form (either full-page or in an iframe).
//
// Body: { amount: number (cents), orderNo: string, ... optional context }
// Returns: { ticket, scriptUrl, environment } — the frontend needs all three
//
// Credentials: 2a reads MCO creds from platform env vars. Per-supplier
// and per-tenant credentials get wired in 2b/2d (via TenantPaymentProvider
// or SupplierProcessor). Keeping the endpoint shape stable so the
// eventual creds source is an internal detail.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import {
  createPreload,
  getMcoCredentialsFromEnv,
  McoApiError,
  type McoCart,
  type McoContact,
  type McoAddress,
} from "@/lib/moneris-checkout";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const body = await request.json().catch(() => ({}));
  const {
    amount,
    orderNo,
    customerId,
    dynamicDescriptor,
    language,
    cart,
    contact,
    shipping,
    billing,
  } = body as {
    amount?: number;
    orderNo?: string;
    customerId?: string;
    dynamicDescriptor?: string;
    language?: "en" | "fr";
    cart?: McoCart;
    contact?: McoContact;
    shipping?: McoAddress;
    billing?: McoAddress;
  };

  if (typeof amount !== "number" || amount <= 0) {
    return NextResponse.json(
      { error: "amount (in cents) is required and must be > 0" },
      { status: 400 }
    );
  }
  if (!orderNo || typeof orderNo !== "string") {
    return NextResponse.json({ error: "orderNo is required" }, { status: 400 });
  }
  // MCO rejects some characters in order_no. Guard against them client-
  // side so the caller sees a clean 400 rather than a Moneris error blob.
  if (/[<>$%=?^{}\[\]\\]/.test(orderNo)) {
    return NextResponse.json(
      { error: "orderNo contains characters Moneris rejects: < > $ % = ? ^ { } [ ] \\" },
      { status: 400 }
    );
  }

  let credentials;
  try {
    credentials = getMcoCredentialsFromEnv();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "MCO credentials not configured on this server. Set MONERIS_MCO_STORE_ID / MONERIS_MCO_API_TOKEN / MONERIS_MCO_CHECKOUT_ID. " +
          (err as Error).message,
      },
      { status: 500 }
    );
  }

  try {
    const result = await createPreload({
      credentials,
      amountCents: amount,
      orderNo,
      customerId,
      dynamicDescriptor,
      language,
      cart,
      contact,
      shipping,
      billing,
    });

    return NextResponse.json({
      success: true,
      provider: "MONERIS_CHECKOUT",
      ticket: result.ticket,
      scriptUrl: result.scriptUrl,
      environment: result.environment,
      // We deliberately DO NOT return the credentials or the raw Moneris
      // response here — the frontend needs only the ticket + script URL.
    });
  } catch (err) {
    if (err instanceof McoApiError) {
      console.error("[MCO PRELOAD] Moneris API error", {
        message: err.message,
        raw: err.raw,
      });
      return NextResponse.json(
        { error: `Moneris rejected the preload: ${err.message}` },
        { status: 502 }
      );
    }
    console.error("[MCO PRELOAD] Unexpected error", err);
    return NextResponse.json(
      { error: (err as Error).message || "Preload failed" },
      { status: 500 }
    );
  }
}
