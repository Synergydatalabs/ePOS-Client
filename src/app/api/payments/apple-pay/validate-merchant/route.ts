// POST /api/payments/apple-pay/validate-merchant
// Apple Pay calls our JS onvalidatemerchant event with a one-time validation URL.
// Our backend then POSTs to that URL using our Apple Pay Merchant Identity Cert
// (held by GP) to get a merchant session blob, which we return to the browser
// so the Apple Pay sheet can render.
//
// Strategy: we don't own the cert — GP does. So we delegate merchant validation
// to GP's gateway by initiating a Drop-in payment intent with apple-pay APM
// enabled. The GP library handles the cert-based handshake server-side and
// returns the merchant session back to us.

import { NextRequest, NextResponse } from "next/server";
import { getDropinAccessToken, getDropinConfig } from "@/lib/gp-dropin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { validationURL, displayName } = body as {
      validationURL?: string;
      displayName?: string;
    };

    if (!validationURL) {
      return NextResponse.json(
        { success: false, error: "validationURL is required" },
        { status: 400 }
      );
    }

    const config = getDropinConfig();

    if (!config.appId || !config.appKey) {
      return NextResponse.json(
        { success: false, error: "GP credentials not configured" },
        { status: 500 }
      );
    }

    // Get a server-side token (no permission filter — defaults to full scope)
    const tokenResp = await getDropinAccessToken({
      permissions: [],
      secondsToExpire: 300,
    });

    // Call GP's Apple Pay merchant-validation endpoint.
    // CONFIRMED PATH: /ucp/payment-methods/apple-pay/sessions
    // GP holds our Apple Pay Merchant Identity Cert (merchant.zashx.com) and
    // uses it for the TLS handshake with Apple during validation.
    const gpBody = {
      validation_url: validationURL,
      merchant_identifier: process.env.GP_DROPIN_APPLE_MERCHANT_ID || "merchant.zashx.com",
      display_name: displayName || "Oreugo",
      domain: new URL(request.url).hostname,
    };

    console.log("[APPLE PAY] POSTing to GP", {
      url: `${config.baseUrl}/ucp/payment-methods/apple-pay/sessions`,
      body: gpBody,
    });

    const gpResp = await fetch(
      `${config.baseUrl}/ucp/payment-methods/apple-pay/sessions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenResp.token}`,
          "X-GP-Version": "2021-03-22",
          Accept: "application/json",
        },
        body: JSON.stringify(gpBody),
      }
    );

    const data = await gpResp.json().catch(() => ({}));

    if (!gpResp.ok) {
      console.error("[APPLE PAY] Merchant validation failed", {
        status: gpResp.status,
        gpResponse: data,
      });
      return NextResponse.json(
        {
          success: false,
          error: (data as any).detailed_error_description || "Merchant validation failed",
          gp: data,
        },
        { status: 500 }
      );
    }

    // GP returns the Apple-signed merchant session blob — pass straight to the
    // browser so JS can call session.completeMerchantValidation(merchantSession)
    return NextResponse.json({
      success: true,
      merchantSession: data,
    });
  } catch (error: any) {
    console.error("[APPLE PAY] validate-merchant error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
