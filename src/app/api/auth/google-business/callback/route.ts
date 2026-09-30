// Google OAuth callback. Receives the auth code, exchanges it for tokens,
// stores them encrypted on the tenant, then bounces the user back to the
// integration page with a location-picker prompt.

import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import prisma from "@/lib/prisma";
import { encryptString } from "@/lib/crypto/encryption";
import { exchangeCodeForTokens } from "@/lib/google-business/client";

const JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

function redirectToIntegration(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/dashboard/admin/integrations/google-business", req.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const errorParam = request.nextUrl.searchParams.get("error");

  if (errorParam) {
    return redirectToIntegration(request, { gbp_error: errorParam.slice(0, 100) });
  }
  if (!code || !state) {
    return redirectToIntegration(request, { gbp_error: "missing code or state" });
  }

  let tenantId: string;
  try {
    const { payload } = await jwtVerify(state, JWT_SECRET);
    tenantId = String((payload as Record<string, unknown>).tenantId || "");
    if (!tenantId) throw new Error("state has no tenantId");
  } catch (err: any) {
    return redirectToIntegration(request, {
      gbp_error: `invalid state: ${err?.message || "unknown"}`,
    });
  }

  let tokens;
  try {
    tokens = await exchangeCodeForTokens(code);
  } catch (err: any) {
    return redirectToIntegration(request, {
      gbp_error: err?.message || "token exchange failed",
    });
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  await prisma.tenantSettings.upsert({
    where: { tenantId },
    update: {
      gbpAccessTokenEnc: encryptString(tokens.access_token),
      gbpRefreshTokenEnc: encryptString(tokens.refresh_token),
      gbpTokenExpiresAt: expiresAt,
      gbpConnected: true,
      gbpConnectedAt: new Date(),
    },
    create: {
      tenantId,
      gbpAccessTokenEnc: encryptString(tokens.access_token),
      gbpRefreshTokenEnc: encryptString(tokens.refresh_token),
      gbpTokenExpiresAt: expiresAt,
      gbpConnected: true,
      gbpConnectedAt: new Date(),
    },
  });

  return redirectToIntegration(request, { gbp_connected: "1" });
}
