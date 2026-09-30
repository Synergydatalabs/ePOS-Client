// =============================================================================
// Phase F #6d (2026-08-27) — Test a Stripe secret key before saving it.
//
// The supplier settings page calls this endpoint after they paste keys, so
// we can catch typos / wrong-account keys BEFORE the "Save" click flips the
// TenantPaymentProvider row to ACTIVE and starts sending invoices to
// customers with an unusable payment link.
//
// The key can be a plain sk_… or a restricted rk_… . We hit
// `GET /v1/balance` — the smallest, cheapest, most permission-inclusive
// call Stripe exposes; a restricted key with only Checkout Sessions Write
// will still pass this if it also has Balance Read (Stripe's default
// restricted-key template includes it).
//
// We do NOT persist anything from this endpoint — save happens in the POST
// handler at ../route.ts. If the caller passes only the secret we skip the
// pk_/sk_ environment sanity check (that's the Save handler's job).
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import { buildStripeClient } from "@/lib/stripe/client";
import { kybDecryptJson } from "@/lib/kyb-crypto";
import type { StripeCredentials } from "@/lib/stripe/types";

async function requireSupplierSession(request: NextRequest) {
  const session = await getPartnerSession(request);
  if (!session) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { id: true, businessType: true },
  });
  if (!tenant || tenant.businessType !== "supplier") {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Not a supplier tenant" }, { status: 403 }),
    };
  }
  return { ok: true as const, session, tenant };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSupplierSession(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    let secretKey = String(body.secretKey || "").trim();

    // Phase F #6f (2026-08-28): partial-update UX. Empty secretKey means
    // "test whatever's already saved" — so the operator can verify the
    // stored key hasn't been rotated/revoked without re-pasting it. Falls
    // back to the encrypted-at-rest key from TenantPaymentProvider.
    if (!secretKey) {
      const existingRow = await prisma.tenantPaymentProvider.findFirst({
        where: {
          tenantId: auth.tenant.id,
          capability: "CARD",
          processor: "STRIPE",
        },
        select: { credentialsEnc: true },
      });
      const existing = existingRow
        ? kybDecryptJson<StripeCredentials>(existingRow.credentialsEnc)
        : null;
      if (existing?.secretKey) {
        secretKey = existing.secretKey;
      }
    }

    if (!secretKey || !(secretKey.startsWith("sk_") || secretKey.startsWith("rk_"))) {
      return NextResponse.json(
        { ok: false, error: "Secret key must start with sk_ or rk_" },
        { status: 400 }
      );
    }

    const stripe = buildStripeClient({
      secretKey,
      // Balance-check doesn't use these — pass placeholders so the type checks.
      publishableKey: "",
      webhookSecret: "",
    });

    // A successful balance call proves: (1) the key parses on Stripe's side,
    // (2) the key hasn't been rotated/revoked, and (3) the key belongs to
    // the account they think it does. We echo the returned currency + a
    // fingerprint so the operator can eyeball "yes, this is the right account".
    const balance = await stripe.balance.retrieve();

    return NextResponse.json({
      ok: true,
      environment: secretKey.includes("_test_") ? "test" : "live",
      currencies: balance.available.map((b: { currency: string }) => b.currency).sort(),
      livemode: balance.livemode,
    });
  } catch (error: any) {
    // Stripe throws `StripeAuthenticationError` for bad keys, `StripePermissionError`
    // for restricted keys without balance-read, etc. Their `.message` is
    // human-readable — pass it through.
    const message =
      error?.raw?.message ||
      error?.message ||
      "Unable to reach Stripe with this key";
    // 200 with ok:false — this is a validation result, not a server failure.
    // Keeps the client UX simple (no try/catch for "expected" bad-key errors).
    return NextResponse.json({ ok: false, error: message });
  }
}
