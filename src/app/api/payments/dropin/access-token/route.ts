// POST /api/payments/dropin/access-token
// Returns a short-lived (10 min) access token for the Drop-in UI on the browser.
// The token has PMT_POST_Create_Single scope — tokenization only, not transactions.

import { NextRequest, NextResponse } from "next/server";
import { getDropinAccessToken, getDropinConfig } from "@/lib/gp-dropin";

export async function POST(_request: NextRequest) {
  try {
    const config = getDropinConfig();

    if (!config.appId || !config.appKey) {
      return NextResponse.json(
        {
          success: false,
          error: "Global Payments Drop-in credentials not configured on the server.",
        },
        { status: 500 }
      );
    }

    const access = await getDropinAccessToken();

    return NextResponse.json({
      success: true,
      token: access.token,
      expiresIn: Math.max(
        1,
        Math.floor((access.expiresAt.getTime() - Date.now()) / 1000)
      ),
      env: config.jsEnv, // "sandbox" | "production"
      jsLibUrl: config.jsLibUrl,
      // Wallet config — browser uses these to render Apple Pay / Google Pay buttons
      wallets: {
        merchantId: config.merchantId || null,
        appleMerchantId: config.appleMerchantId || null,
        country: config.country,
        currency: config.currency,
      },
    });
  } catch (error: any) {
    console.error("[DROPIN] access-token error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Failed to create Drop-in access token",
      },
      { status: 500 }
    );
  }
}

// Allow GET as well (friendlier for browser debugging)
export async function GET(request: NextRequest) {
  return POST(request);
}
