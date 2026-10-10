// =============================================================================
// 2026-10-09 — Supplier self-serve Helcim settings.
//
// GET  → returns the current stored Helcim configuration MASKED (never
//        returns the raw API token to the browser). Includes a
//        "configured" flag so the UI can show "Active" vs "Not set".
// POST → accepts api_token + webhook_verifier + environment, encrypts
//        via kyb-crypto, upserts the TenantPaymentProvider row
//        (capability=CARD, processor=HELCIM), flips to ACTIVE and
//        auto-SUSPENDS any other CARD processor (Stripe) — mutual
//        exclusivity per tenant.
//
// Auth: partner JWT cookie → tenant must be businessType='supplier'.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import { kybEncryptJson, kybDecryptJson } from "@/lib/kyb-crypto";
import type { HelcimCredentials } from "@/lib/helcim/types";

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

function maskToken(token: string | null | undefined): string | null {
  if (!token) return null;
  if (token.length <= 12) return "•".repeat(token.length);
  return `${token.slice(0, 4)}${"•".repeat(10)}${token.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSupplierSession(request);
    if (!auth.ok) return auth.response;

    const row = await prisma.tenantPaymentProvider.findFirst({
      where: { tenantId: auth.tenant.id, processor: "HELCIM" },
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
        apiTokenMasked: null,
        webhookVerifierMasked: null,
        accountName: null,
        environment: null,
        activatedAt: null,
      });
    }

    const creds = kybDecryptJson<HelcimCredentials>(row.credentialsEnc);
    return NextResponse.json({
      success: true,
      configured: !!creds?.apiToken,
      status: row.status,
      apiTokenMasked: maskToken(creds?.apiToken),
      webhookVerifierMasked: maskToken(creds?.webhookVerifier),
      accountName: creds?.accountName || row.externalMid || null,
      environment: creds?.environment ?? null,
      activatedAt: row.activatedAt,
    });
  } catch (error: any) {
    console.error("[SUPPLIER-SETTINGS-HELCIM] GET error:", error);
    return NextResponse.json({ error: "Failed to load Helcim settings" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSupplierSession(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const apiTokenInput = String(body.apiToken || "").trim();
    const webhookVerifierInput = String(body.webhookVerifier || "").trim();
    const accountNameInput = String(body.accountName || "").trim();
    const environmentInput = String(body.environment || "").toLowerCase().trim();

    const existingRow = await prisma.tenantPaymentProvider.findFirst({
      where: {
        tenantId: auth.tenant.id,
        capability: "CARD",
        processor: "HELCIM",
      },
      select: { credentialsEnc: true, externalMid: true },
    });
    const existing = existingRow
      ? kybDecryptJson<HelcimCredentials>(existingRow.credentialsEnc)
      : null;

    const apiToken = apiTokenInput || existing?.apiToken || "";
    const webhookVerifier = webhookVerifierInput || existing?.webhookVerifier || "";
    const accountName =
      accountNameInput ||
      existing?.accountName ||
      existingRow?.externalMid ||
      auth.tenant.name;
    const environment: "test" | "live" =
      environmentInput === "live"
        ? "live"
        : environmentInput === "test"
          ? "test"
          : (existing?.environment ?? "test");

    if (!apiToken || apiToken.length < 10) {
      return NextResponse.json(
        { error: "API token looks too short — paste the full value from the Helcim portal" },
        { status: 400 }
      );
    }

    const credentials: HelcimCredentials = {
      apiToken,
      webhookVerifier,
      accountName,
      environment,
    };
    const credentialsEnc = kybEncryptJson(credentials);
    if (!credentialsEnc) {
      return NextResponse.json({ error: "Failed to encrypt credentials" }, { status: 500 });
    }

    // Mutex: only one ACTIVE CARD processor per tenant. Flip any other
    // CARD processor row (Stripe) to SUSPENDED when we activate Helcim.
    await prisma.$transaction(async (tx) => {
      await tx.tenantPaymentProvider.updateMany({
        where: {
          tenantId: auth.tenant.id,
          capability: "CARD",
          processor: { not: "HELCIM" },
          status: "ACTIVE",
        },
        data: {
          status: "SUSPENDED",
          suspendedAt: new Date(),
          suspensionReason: "Replaced by Helcim as active CARD processor",
        },
      });

      await tx.tenantPaymentProvider.upsert({
        where: {
          tenantId_capability_processor: {
            tenantId: auth.tenant.id,
            capability: "CARD",
            processor: "HELCIM",
          },
        },
        create: {
          tenantId: auth.tenant.id,
          capability: "CARD",
          processor: "HELCIM",
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
      });
    });

    return NextResponse.json({
      success: true,
      environment,
      status: "ACTIVE",
    });
  } catch (error: any) {
    // 2026-10-09: surface the real reason so the UI shows something
    // actionable instead of a generic "Failed to save". The three usual
    // suspects on fresh deploys:
    //   - KYB_ENCRYPTION_KEY env var missing (kybEncryptJson throws)
    //   - PaymentProcessor enum doesn't include HELCIM in Postgres yet
    //     (Prisma P2032 / "invalid input value for enum")
    //   - DB connection error
    const raw = String(error?.message || error || "unknown");
    const code = error?.code ? ` [${error.code}]` : "";
    console.error("[SUPPLIER-SETTINGS-HELCIM] POST error:", error);

    let hint = "";
    if (/KYB_ENCRYPTION_KEY/i.test(raw)) {
      hint =
        " — The server is missing KYB_ENCRYPTION_KEY. Ask ops to set it on the itap-app environment and restart.";
    } else if (/HELCIM|invalid input value for enum|P2032/i.test(raw)) {
      hint =
        " — The PaymentProcessor enum in Postgres doesn't include HELCIM yet. Run: ALTER TYPE \"PaymentProcessor\" ADD VALUE IF NOT EXISTS 'HELCIM';";
    }

    return NextResponse.json(
      { error: `Failed to save Helcim settings${code}: ${raw.slice(0, 300)}${hint}` },
      { status: 500 }
    );
  }
}
