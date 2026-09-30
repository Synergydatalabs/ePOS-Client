// POST /api/tenants/[tenantId]/payments/charge
//
// Provider-agnostic dispatcher — the ONE endpoint the POS calls when it
// wants to charge a terminal. Reads the tenant's active CARD provider,
// looks up the appropriate provider-specific route from the endpoint
// registry, and forwards the request there. Response is passed through
// unchanged so the POS sees the same shape it would from a direct call.
//
// This route stays thin FOREVER — adding a new provider means only:
//   1. New folder under payments/<provider>/charge/route.ts
//   2. Add mapping in payment-providers/endpoint-registry.ts
// This file never changes.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import { getActiveProvider } from "@/lib/payment-providers/provider-router";
import { CHARGE_ENDPOINT } from "@/lib/payment-providers/endpoint-registry";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  // Auth check happens once at the dispatcher AND again inside each
  // provider route. Yes, that's double auth — we validate here so a
  // caller without a valid session can't discover which provider is
  // configured for the tenant (would be an information leak).
  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  let activeProvider: Awaited<ReturnType<typeof getActiveProvider>>;
  try {
    activeProvider = await getActiveProvider({ tenantId, capability: "CARD" });
  } catch (routerErr) {
    return NextResponse.json(
      {
        error:
          "Payment provider credentials could not be resolved for this tenant. " +
          (routerErr as Error).message,
      },
      { status: 500 }
    );
  }
  if (!activeProvider) {
    return NextResponse.json(
      {
        error:
          "No CARD payment provider assigned for this tenant. Assign one from the admin panel first.",
      },
      { status: 400 }
    );
  }

  const endpointFn = CHARGE_ENDPOINT[activeProvider.processor];
  if (!endpointFn) {
    return NextResponse.json(
      {
        error: `No charge endpoint registered for processor '${activeProvider.processor}'.`,
      },
      { status: 501 }
    );
  }

  // Internal forward. Read the body once, replay it to the provider
  // route via a fresh Request that keeps the caller's cookies (needed
  // for the per-route auth check). No redirect — the POS should never
  // see the provider-specific URL.
  const bodyText = await request.text();
  const forwardUrl = new URL(endpointFn(tenantId), request.url);

  // Preserve only headers the downstream route actually needs. Cookies
  // carry the session; content-type tells the route to parse JSON.
  // Skip host / content-length — Node fetch reconstructs those.
  const forwardHeaders = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) forwardHeaders.set("cookie", cookie);
  const contentType = request.headers.get("content-type");
  if (contentType) forwardHeaders.set("content-type", contentType);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) forwardHeaders.set("x-forwarded-for", forwarded);

  const forwardRes = await fetch(forwardUrl, {
    method: "POST",
    headers: forwardHeaders,
    body: bodyText,
  });

  // Pass through the provider's response as-is. Setting the same status
  // + body means POS clients only need to know one response shape per
  // provider (which they already handle when calling providers directly).
  const responseBody = await forwardRes.text();
  return new NextResponse(responseBody, {
    status: forwardRes.status,
    headers: {
      "content-type": forwardRes.headers.get("content-type") || "application/json",
    },
  });
}
