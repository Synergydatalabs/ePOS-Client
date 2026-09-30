import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

// Uber will call this endpoint with your Client ID + Secret to get a Bearer token.
// It then uses that token in the Authorization header when sending webhooks.

const UBER_WH_CLIENT_ID = process.env.UBER_EATS_WH_CLIENT_ID || "itap_uber_wh_prod_2026";
const UBER_WH_CLIENT_SECRET =
  process.env.UBER_EATS_WH_CLIENT_SECRET ||
  "2f811c20e2c7b869e909f201672a4ffc66f3eb263d8ec8fa8985a80088a25888";

const JWT_SECRET = new TextEncoder().encode(UBER_WH_CLIENT_SECRET);

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    let clientId: string | null = null;
    let clientSecret: string | null = null;
    let grantType: string | null = null;

    // Support both form-urlencoded and JSON
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await request.formData();
      clientId = formData.get("client_id") as string;
      clientSecret = formData.get("client_secret") as string;
      grantType = formData.get("grant_type") as string;
    } else {
      const body = await request.json();
      clientId = body.client_id;
      clientSecret = body.client_secret;
      grantType = body.grant_type;
    }

    // Validate credentials
    if (clientId !== UBER_WH_CLIENT_ID || clientSecret !== UBER_WH_CLIENT_SECRET) {
      return NextResponse.json(
        { error: "invalid_client", error_description: "Invalid client credentials" },
        { status: 401 }
      );
    }

    if (grantType !== "client_credentials") {
      return NextResponse.json(
        { error: "unsupported_grant_type", error_description: "Only client_credentials is supported" },
        { status: 400 }
      );
    }

    // Generate access token (valid for 1 hour)
    const expiresIn = 3600;
    const token = await new SignJWT({ sub: clientId, type: "uber_webhook" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(`${expiresIn}s`)
      .sign(JWT_SECRET);

    return NextResponse.json({
      access_token: token,
      token_type: "Bearer",
      expires_in: expiresIn,
    });
  } catch (error) {
    console.error("[UBER WEBHOOK] Token error:", error);
    return NextResponse.json(
      { error: "server_error", error_description: "Failed to generate token" },
      { status: 500 }
    );
  }
}
