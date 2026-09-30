// GET /api/integrations/quickbooks/authorize?tenantId=<uuid>&region=US|CA
//
// Kicks off the Intuit OAuth flow. We must know both the tenant and the
// region up-front so the callback (which has no session context of its
// own) can encode both in the `state` param and route back correctly.
// Requires POS_ADMIN on the target tenant.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import { buildAuthorizeUrl, type Region } from "@/lib/quickbooks";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get("tenantId") || "";
  const region = (searchParams.get("region") || "US").toUpperCase() as Region;
  if (!tenantId || (region !== "US" && region !== "CA")) {
    return NextResponse.json(
      { error: "tenantId + region (US|CA) are required" },
      { status: 400 }
    );
  }

  const auth = await validateRequest(request, tenantId, "POS_ADMIN");
  if (!auth.success) return auth.response;

  // Capture the origin the merchant came from so the callback can bounce
  // them back to their branded partner domain (e.g. oreugo.ca) instead
  // of iTap's canonical URL. Intuit only permits ONE fixed redirect_uri
  // per app, so all callbacks land on iTap first; we hand them off from
  // there to the right origin.
  const origin =
    request.headers.get("referer") || request.headers.get("origin") || "";
  let originHost = "";
  try {
    if (origin) originHost = new URL(origin).host;
  } catch {
    /* ignore malformed referer */
  }

  const url = buildAuthorizeUrl(tenantId, region, originHost);
  if (!url) {
    return NextResponse.json(
      {
        error: `QuickBooks ${region} not configured on this server (missing QBO_${region}_CLIENT_ID / SECRET env vars)`,
      },
      { status: 503 }
    );
  }

  return NextResponse.redirect(url);
}
