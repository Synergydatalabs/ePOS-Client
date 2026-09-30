// =============================================================================
// Phase F #6d (2026-08-27) — Supplier self-serve Stripe settings.
//
// GET  → returns the current stored Stripe configuration for this supplier,
//        MASKED (never returns the raw secret to the browser). Includes a
//        "hasSecretKey" flag so the UI can show "Configured" vs "Not set".
// POST → accepts pk_… + sk_…/rk_… + whsec_… , encrypts via kyb-crypto,
//        upserts the TenantPaymentProvider row (capability=CARD,
//        processor=STRIPE), and flips it to ACTIVE.
//
// Auth: partner JWT cookie → tenant must be businessType='supplier'.
// Any supplier's owner-role membership can call this.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import { kybEncryptJson, kybDecryptJson } from "@/lib/kyb-crypto";
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
    select: { id: true, name: true, businessType: true },
  });
  if (!tenant || tenant.businessType !== "supplier") {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Not a supplier tenant" }, { status: 403 }),
    };
  }
  return { ok: true as const, session, tenant };
}

// Mask everything except the recognisable prefix + last 4 chars so the UI can
// show "configured" without revealing anything reusable.
function maskKey(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.length <= 12) return "•".repeat(key.length);
  const prefixMatch = key.match(/^(sk|pk|rk|whsec)_(live|test)_/);
  const prefix = prefixMatch ? prefixMatch[0] : key.slice(0, 8);
  const tail = key.slice(-4);
  return `${prefix}${"•".repeat(8)}${tail}`;
}

function detectEnv(key: string): "test" | "live" | "unknown" {
  if (key.includes("_test_")) return "test";
  if (key.includes("_live_")) return "live";
  return "unknown";
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSupplierSession(request);
    if (!auth.ok) return auth.response;

    const row = await prisma.tenantPaymentProvider.findFirst({
      where: {
        tenantId: auth.tenant.id,
        processor: "STRIPE",
      },
      select: {
        id: true,
        status: true,
        activatedAt: true,
        externalMid: true,
        credentialsEnc: true,
      },
    });

    if (!row) {
      return NextResponse.json({
        success: true,
        configured: false,
        status: null,
        publishableKey: null,
        secretKeyMasked: null,
        webhookSecretMasked: null,
        accountName: null,
        environment: null,
        activatedAt: null,
      });
    }

    const creds = kybDecryptJson<StripeCredentials>(row.credentialsEnc);
    return NextResponse.json({
      success: true,
      configured: !!creds?.secretKey,
      status: row.status,
      // Publishable key is safe to return in full — it's already public.
      publishableKey: creds?.publishableKey || null,
      secretKeyMasked: maskKey(creds?.secretKey),
      webhookSecretMasked: maskKey(creds?.webhookSecret),
      accountName: creds?.accountName || row.externalMid || null,
      environment: creds?.secretKey ? detectEnv(creds.secretKey) : null,
      activatedAt: row.activatedAt,
    });
  } catch (error: any) {
    console.error("[SUPPLIER-SETTINGS-PAYMENTS] GET error:", error);
    return NextResponse.json({ error: "Failed to load payment settings" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSupplierSession(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const publishableKeyInput = String(body.publishableKey || "").trim();
    const secretKeyInput = String(body.secretKey || "").trim();
    const webhookSecretInput = String(body.webhookSecret || "").trim();
    const accountNameInput = String(body.accountName || "").trim();

    // Phase F #6f (2026-08-28): partial-update semantics. If the tenant
    // already has a stored row, empty inputs mean "keep the existing
    // value" — so the operator can rotate one field without re-typing
    // the others. Load the existing credentials so we can fall back.
    const existingRow = await prisma.tenantPaymentProvider.findFirst({
      where: {
        tenantId: auth.tenant.id,
        capability: "CARD",
        processor: "STRIPE",
      },
      select: { credentialsEnc: true, externalMid: true },
    });
    const existing = existingRow
      ? kybDecryptJson<StripeCredentials>(existingRow.credentialsEnc)
      : null;

    const publishableKey = publishableKeyInput || existing?.publishableKey || "";
    const secretKey = secretKeyInput || existing?.secretKey || "";
    const webhookSecret =
      webhookSecretInput || existing?.webhookSecret || "";
    const accountName =
      accountNameInput || existing?.accountName || existingRow?.externalMid || auth.tenant.name;

    if (!secretKey || !(secretKey.startsWith("sk_") || secretKey.startsWith("rk_"))) {
      return NextResponse.json(
        { error: "Secret key must start with sk_ or rk_" },
        { status: 400 }
      );
    }
    if (!publishableKey || !publishableKey.startsWith("pk_")) {
      return NextResponse.json(
        { error: "Publishable key must start with pk_" },
        { status: 400 }
      );
    }
    // Webhook secret is technically optional (they can add it after they
    // create the endpoint in Stripe), but we warn from the UI.
    if (webhookSecret && !webhookSecret.startsWith("whsec_")) {
      return NextResponse.json(
        { error: "Webhook secret must start with whsec_" },
        { status: 400 }
      );
    }
    // Test/live mismatch between the two keys is almost always a paste
    // mistake — refuse rather than half-configure the tenant.
    if (detectEnv(secretKey) !== detectEnv(publishableKey)) {
      return NextResponse.json(
        { error: "Secret key and publishable key are from different environments (one is test, the other is live)" },
        { status: 400 }
      );
    }

    const credentials: StripeCredentials = {
      secretKey,
      publishableKey,
      webhookSecret,
      accountName,
    };
    const credentialsEnc = kybEncryptJson(credentials);
    if (!credentialsEnc) {
      return NextResponse.json({ error: "Failed to encrypt credentials" }, { status: 500 });
    }

    const row = await prisma.tenantPaymentProvider.upsert({
      where: {
        tenantId_capability_processor: {
          tenantId: auth.tenant.id,
          capability: "CARD",
          processor: "STRIPE",
        },
      },
      create: {
        tenantId: auth.tenant.id,
        capability: "CARD",
        processor: "STRIPE",
        externalMid: accountName,
        credentialsEnc,
        status: "ACTIVE",
        activatedAt: new Date(),
      },
      update: {
        credentialsEnc,
        externalMid: accountName,
        status: "ACTIVE",
        activatedAt: new Date(),
        suspendedAt: null,
        suspensionReason: null,
      },
      select: { id: true, status: true, activatedAt: true },
    });

    return NextResponse.json({
      success: true,
      status: row.status,
      environment: detectEnv(secretKey),
      activatedAt: row.activatedAt,
    });
  } catch (error: any) {
    console.error("[SUPPLIER-SETTINGS-PAYMENTS] POST error:", error);
    return NextResponse.json({ error: "Failed to save payment settings" }, { status: 500 });
  }
}
