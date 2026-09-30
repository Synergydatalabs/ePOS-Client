#!/usr/bin/env node
/* eslint-disable no-console */
// =============================================================================
// Phase F #4 (2026-08-27) — Seed the TenantPaymentProvider row that wires
// Synergy Data Labs's supplier tenant to Stripe (test mode).
//
// Run on EC2 with the same env vars the app uses:
//   DATABASE_URL          — Postgres connection string
//   KYB_ENCRYPTION_KEY    — 32-byte base64 key used by kyb-crypto to encrypt
//                           the credentials blob
//
// Then:
//   cd C:\Mod App\tap-app  (or wherever tap-app is on EC2)
//   node scripts/seed-synergy-stripe.mjs
//
// The script is idempotent: it INSERTs if no row exists for
// (tenant, capability=CARD, processor=STRIPE), and UPDATEs the credentials
// on re-run so you can rotate keys by editing this file and re-running.
//
// Also idempotent on the webhook secret — leave WEBHOOK_SECRET blank and
// re-run later after you create the endpoint in Stripe Dashboard.
// =============================================================================

import { PrismaClient } from "@prisma/client";
import { randomBytes, createCipheriv } from "crypto";

// ------------------------------------------------------------------------
// Config — edit here on key rotation
// ------------------------------------------------------------------------
const SUPPLIER_TENANT_SLUG = "synergy-data-labs";

// Stripe credentials — MUST come from env. Never commit real keys to git.
// Set these in your shell before running:
//   $env:SYNERGY_STRIPE_SECRET_KEY = "rk_test_… or rk_live_…"
//   $env:SYNERGY_STRIPE_PUBLISHABLE_KEY = "pk_test_… or pk_live_…"
const STRIPE_SECRET_KEY = process.env.SYNERGY_STRIPE_SECRET_KEY || "";
const STRIPE_PUBLISHABLE_KEY = process.env.SYNERGY_STRIPE_PUBLISHABLE_KEY || "";

if (!STRIPE_SECRET_KEY || !STRIPE_PUBLISHABLE_KEY) {
  console.error(
    "ERROR: SYNERGY_STRIPE_SECRET_KEY and SYNERGY_STRIPE_PUBLISHABLE_KEY env vars are required.\n" +
    "Set them in your shell before running this seed script."
  );
  process.exit(1);
}

// Populate once you've created the webhook endpoint in Stripe Dashboard
// (Developers → Webhooks → Add endpoint →
//   URL: https://hub.synergydatalabs.com/api/webhooks/payment/stripe/supplier-invoice
//   Events: checkout.session.completed, charge.refunded, payment_intent.payment_failed
// ) and copied the signing secret. Leave "" and re-run when ready.
const STRIPE_WEBHOOK_SECRET = "";

const ACCOUNT_NAME = "Synergy Data Labs — Test";

// ------------------------------------------------------------------------
// Inline AES-256-GCM (mirrors src/lib/kyb-crypto.ts so we don't depend
// on the compiled Next build to run this script)
// ------------------------------------------------------------------------
function kybEncryptJson(value) {
  if (value == null) return null;
  const raw = process.env.KYB_ENCRYPTION_KEY;
  if (!raw) throw new Error("KYB_ENCRYPTION_KEY env var is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`KYB_ENCRYPTION_KEY must be 32 bytes base64 (got ${key.length})`);
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

// ------------------------------------------------------------------------
// Run
// ------------------------------------------------------------------------
const prisma = new PrismaClient();

async function main() {
  if (!STRIPE_SECRET_KEY.startsWith("sk_") && !STRIPE_SECRET_KEY.startsWith("rk_")) {
    throw new Error("STRIPE_SECRET_KEY must start with sk_ or rk_");
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug: SUPPLIER_TENANT_SLUG },
    select: { id: true, name: true },
  });
  if (!tenant) {
    throw new Error(
      `Tenant with slug='${SUPPLIER_TENANT_SLUG}' not found. Did you run the supplier onboarding SQL first?`
    );
  }
  console.log(`[seed] Tenant: ${tenant.name} (${tenant.id})`);

  const credentials = {
    secretKey: STRIPE_SECRET_KEY,
    publishableKey: STRIPE_PUBLISHABLE_KEY,
    webhookSecret: STRIPE_WEBHOOK_SECRET,
    accountName: ACCOUNT_NAME,
  };
  const credentialsEnc = kybEncryptJson(credentials);

  const row = await prisma.tenantPaymentProvider.upsert({
    where: {
      tenantId_capability_processor: {
        tenantId: tenant.id,
        capability: "CARD",
        processor: "STRIPE",
      },
    },
    create: {
      tenantId: tenant.id,
      capability: "CARD",
      processor: "STRIPE",
      externalMid: ACCOUNT_NAME,
      credentialsEnc,
      status: "ACTIVE",
      activatedAt: new Date(),
    },
    update: {
      credentialsEnc,
      externalMid: ACCOUNT_NAME,
      status: "ACTIVE",
      activatedAt: new Date(),
      suspendedAt: null,
      suspensionReason: null,
    },
    select: { id: true, status: true, activatedAt: true },
  });

  console.log(`[seed] TenantPaymentProvider ${row.id} — status=${row.status}`);
  if (!STRIPE_WEBHOOK_SECRET) {
    console.log(
      `[seed] NOTE: webhookSecret is empty. Create the webhook in Stripe Dashboard, then re-run this script with it filled in.`
    );
  }
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
