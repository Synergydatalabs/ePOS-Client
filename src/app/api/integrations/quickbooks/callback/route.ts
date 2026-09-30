// GET /api/integrations/quickbooks/callback
//
// Intuit redirects here after the merchant grants access. Query params:
//   code, state (encoded as "REGION:tenantId"), realmId
//
// We exchange the code for tokens, persist them encrypted, and redirect
// the browser to the admin integrations page.
//
// No auth middleware runs here — the callback happens in a top-level
// browser context after Intuit's consent screen and doesn't carry our
// session cookie reliably across the OAuth redirect. The security
// guardrail is Intuit's issued `code` (single-use, short-lived) plus
// the `state` we set and verify. A malicious caller can't fabricate a
// valid code because they'd need to have been through Intuit's flow.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  exchangeCodeForTokens,
  regionToProvider,
  type Region,
} from "@/lib/quickbooks";
import { encryptToken } from "@/lib/integration-crypto";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state") || "";
  const realmId = searchParams.get("realmId");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  const [regionRaw, tenantId, originHost] = state.split(":");
  const region = (regionRaw || "").toUpperCase() as Region;

  // Where to send the merchant back — the admin integrations page for
  // that tenant, on the branded partner domain they started from when
  // possible. Falls back to the callback's own host (iTap canonical) if
  // no origin was captured.
  const path = tenantId
    ? `/dashboard/admin/integrations/quickbooks?tenant=${tenantId}`
    : "/dashboard/admin";
  // Only trust the origin host if it looks like a bare hostname (no
  // scheme, path, or credentials injection). Prevents an attacker
  // crafting a state that bounces users to an external URL after a real
  // successful OAuth handshake.
  const safeOriginHost =
    originHost && /^[a-z0-9.-]+(:\d+)?$/i.test(originHost) ? originHost : "";
  const callbackUrl = new URL(request.url);
  const baseUrl = safeOriginHost
    ? `${callbackUrl.protocol}//${safeOriginHost}`
    : callbackUrl.origin;
  const returnUrl = `${baseUrl}${path}`;

  if (error) {
    // Merchant declined or Intuit rejected — bounce back with a message.
    const msg = encodeURIComponent(errorDescription || error);
    return NextResponse.redirect(`${returnUrl}&qboError=${msg}`);
  }
  if (!code || !realmId || !tenantId || (region !== "US" && region !== "CA")) {
    return NextResponse.redirect(
      `${returnUrl}&qboError=${encodeURIComponent("Missing callback parameters")}`
    );
  }

  try {
    const tok = await exchangeCodeForTokens(region, code);
    const provider = regionToProvider(region);
    const expiresAt = new Date(Date.now() + tok.expires_in * 1000);

    await prisma.integrationConnection.upsert({
      where: { tenantId_provider: { tenantId, provider } },
      create: {
        tenantId,
        provider,
        status: "CONNECTED",
        realmId,
        accessTokenEnc: encryptToken(tok.access_token),
        refreshTokenEnc: encryptToken(tok.refresh_token),
        accessTokenExpires: expiresAt,
        connectedAt: new Date(),
      },
      update: {
        status: "CONNECTED",
        realmId,
        accessTokenEnc: encryptToken(tok.access_token),
        refreshTokenEnc: encryptToken(tok.refresh_token),
        accessTokenExpires: expiresAt,
        connectedAt: new Date(),
        lastError: null,
        lastErrorAt: null,
      },
    });

    return NextResponse.redirect(`${returnUrl}&qboConnected=1`);
  } catch (err: any) {
    console.error("[qbo callback] error:", err);
    return NextResponse.redirect(
      `${returnUrl}&qboError=${encodeURIComponent(err?.message || "Token exchange failed")}`
    );
  }
}
