// GET /api/public/v1/config — Phase I #11 (2026-09-19)
//
// Returns the safe-to-expose config a partner's frontend needs to
// initialise Stripe.js and tokenize cards on their own page (before
// forwarding the token to /api/public/v1/payments/charge).
//
// Only publishable Stripe values are returned — never the secret key,
// never the webhook signing secret. Bearer auth via the partner's
// oreugo API key so we know which tenant to look up.
//
// Response 200:
//   {
//     "publishable_key": "pk_test_...",
//     "currency":        "cad",
//     "tenant_id":       "<uuid>"
//   }

import { NextRequest, NextResponse } from "next/server";
import {
  requireApiKey,
  apiErrorResponse,
  PUBLIC_API_CORS_HEADERS,
  corsPreflightResponse,
} from "@/lib/api-keys";
import { loadActiveSupplierStripe } from "@/lib/supplier-stripe";
import prisma from "@/lib/prisma";

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function GET(request: NextRequest) {
  const auth = await requireApiKey(request);
  if (!auth.ok) {
    const { status, body, headers } = apiErrorResponse(auth.error);
    return NextResponse.json(body, {
      status,
      headers: { ...PUBLIC_API_CORS_HEADERS, ...(headers ?? {}) },
    });
  }
  const { tenantId } = auth.key;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, status: true, currency: true },
  });
  if (!tenant || tenant.status !== "ACTIVE") {
    return NextResponse.json(
      { error: { type: "tenant_error", message: "Tenant is not active" } },
      { status: 403, headers: PUBLIC_API_CORS_HEADERS }
    );
  }

  const creds = await loadActiveSupplierStripe(tenantId);
  if (!creds?.publishableKey) {
    return NextResponse.json(
      {
        error: {
          type: "tenant_error",
          message:
            "Tenant has no active Stripe processor — configure Stripe keys under Settings → Payments first",
        },
      },
      { status: 402, headers: PUBLIC_API_CORS_HEADERS }
    );
  }

  return NextResponse.json(
    {
      publishable_key: creds.publishableKey,
      currency: tenant.currency.toLowerCase(),
      tenant_id: tenant.id,
    },
    {
      status: 200,
      headers: {
        ...PUBLIC_API_CORS_HEADERS,
        // Publishable key is safe to cache — rotate on ~1 min freshness.
        "Cache-Control": "public, max-age=60",
      },
    }
  );
}

export async function POST() {
  return NextResponse.json(
    { error: { type: "invalid_request_error", message: "Method not allowed. Use GET." } },
    { status: 405, headers: { Allow: "GET", ...PUBLIC_API_CORS_HEADERS } }
  );
}
