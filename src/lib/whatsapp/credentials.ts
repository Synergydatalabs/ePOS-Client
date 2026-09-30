// ============================================================================
// src/lib/whatsapp/credentials.ts
//
// Per-tenant WhatsApp credential lookup. Single source of truth for
// "which Meta phone/token should this tenant send/receive with?"
//
// Resolution order (first match wins):
//   1. Tenant has its own connected credentials in DB    → "tenant"
//   2. Shared platform credentials in env vars           → "shared"
//   3. Nothing                                            → "none"
//
// The webhook side (inbound) uses findTenantByPhoneNumberId — given the
// phone_number_id from Meta's payload, reverse-lookup which tenant owns it.
//
// All token-shaped fields are AES-256-GCM encrypted at rest. We decrypt
// on every fetch and cache nothing (so credential rotation is instant).
// ============================================================================

import prisma from "@/lib/prisma";
import { decryptString } from "@/lib/crypto/encryption";

export type CredentialSource = "tenant" | "shared" | "none";

export interface ResolvedMetaCredentials {
  source: CredentialSource;
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;             // for inbound HMAC verification
  webhookVerifyToken: string;    // for Meta verification handshake
  wabaId?: string;
  displayName?: string;
  connectionType?: string;       // 'manual' | 'embedded' | 'shared'
}

interface SharedEnvCreds {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  webhookVerifyToken: string;
  wabaId?: string;
}

function getSharedFromEnv(): SharedEnvCreds {
  return {
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || "",
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || "",
    appSecret: process.env.META_WHATSAPP_APP_SECRET || "",
    webhookVerifyToken: process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN || "",
    wabaId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || undefined,
  };
}

function hasUsableCreds(c: { phoneNumberId: string; accessToken: string }): boolean {
  return Boolean(c.phoneNumberId && c.accessToken);
}

/**
 * Resolve credentials for sending FROM a tenant. Returns whichever set is
 * usable, plus a `source` tag so callers can log which path was taken.
 */
export async function resolveMetaCredentialsForTenant(
  tenantId: string
): Promise<ResolvedMetaCredentials | null> {
  // Read minimal columns; avoid pulling the whole Tenant row.
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      metaPhoneNumberId: true,
      metaAccessTokenEnc: true,
      metaAppSecretEnc: true,
      metaWebhookVerifyTokenEnc: true,
      metaWabaId: true,
      metaDisplayName: true,
      metaConnectionType: true,
    },
  }).catch(() => null);

  if (
    t?.metaPhoneNumberId &&
    t?.metaAccessTokenEnc
  ) {
    try {
      const accessToken = decryptString(t.metaAccessTokenEnc) || "";
      const appSecret = decryptString(t.metaAppSecretEnc) || "";
      const webhookVerifyToken = decryptString(t.metaWebhookVerifyTokenEnc) || "";
      if (accessToken) {
        return {
          source: "tenant",
          phoneNumberId: t.metaPhoneNumberId,
          accessToken,
          appSecret,
          webhookVerifyToken,
          wabaId: t.metaWabaId || undefined,
          displayName: t.metaDisplayName || undefined,
          connectionType: t.metaConnectionType || undefined,
        };
      }
    } catch (err) {
      console.error(
        `[whatsapp/credentials] decrypt failed for tenant=${tenantId.slice(0, 8)}:`,
        err
      );
      // Fall through to shared — bad cipher shouldn't take the platform down.
    }
  }

  const shared = getSharedFromEnv();
  if (hasUsableCreds(shared)) {
    return {
      source: "shared",
      phoneNumberId: shared.phoneNumberId,
      accessToken: shared.accessToken,
      appSecret: shared.appSecret,
      webhookVerifyToken: shared.webhookVerifyToken,
      wabaId: shared.wabaId,
      connectionType: "shared",
    };
  }

  return null;
}

/**
 * Reverse lookup: given the phone_number_id Meta sent in a webhook payload,
 * find which tenant owns it. Used by the inbound webhook to route messages
 * to the right tenant's waitlist/reservations/conversation log.
 *
 * Returns null if the phone_number_id belongs to the shared platform sender
 * (in which case caller should fall back to "scan all tenants" or whatever
 * legacy behaviour applied).
 */
export async function findTenantByPhoneNumberId(
  phoneNumberId: string
): Promise<{ id: string; name: string; displayName: string | null } | null> {
  if (!phoneNumberId) return null;
  const t = await prisma.tenant.findFirst({
    where: { metaPhoneNumberId: phoneNumberId },
    select: { id: true, name: true, metaDisplayName: true },
  }).catch(() => null);
  if (!t) return null;
  return { id: t.id, name: t.name, displayName: t.metaDisplayName };
}

/**
 * Get the shared platform verify-token (without exposing the rest of env).
 * Webhook GET handshake — Meta uses ONE callback URL per app, so the verify
 * token is platform-wide, NOT per-tenant.
 */
export function getSharedWebhookVerifyToken(): string {
  return process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN || "";
}

/**
 * Get the shared platform app secret (for inbound HMAC). Same logic — Meta
 * signs all inbound payloads with ONE app's secret, regardless of which
 * tenant's number the message went to.
 *
 * For tenant-BYO setups in the "embedded" flow, the app secret IS shared
 * (because we proxy through OUR app). For "manual" tenants who registered
 * their own Meta app, they configure the webhook to point at us but use
 * THEIR app secret — those cases fall back to tenant.metaAppSecretEnc
 * verification in the webhook handler.
 */
export function getSharedAppSecret(): string {
  return process.env.META_WHATSAPP_APP_SECRET || "";
}

/**
 * Lightweight status reporter for admin UI — does NOT decrypt secrets,
 * only reports presence/absence and connection metadata.
 */
export async function getTenantWhatsAppStatus(tenantId: string): Promise<{
  connected: boolean;
  source: CredentialSource;
  phoneNumberId: string | null;
  displayName: string | null;
  connectionType: string | null;
  connectedAt: Date | null;
  healthStatus: string | null;
  lastHealthCheckAt: Date | null;
}> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      metaPhoneNumberId: true,
      metaAccessTokenEnc: true,
      metaDisplayName: true,
      metaConnectionType: true,
      metaConnectedAt: true,
      metaHealthStatus: true,
      metaLastHealthCheckAt: true,
    },
  }).catch(() => null);

  if (t?.metaPhoneNumberId && t?.metaAccessTokenEnc) {
    return {
      connected: true,
      source: "tenant",
      phoneNumberId: t.metaPhoneNumberId,
      displayName: t.metaDisplayName,
      connectionType: t.metaConnectionType,
      connectedAt: t.metaConnectedAt,
      healthStatus: t.metaHealthStatus,
      lastHealthCheckAt: t.metaLastHealthCheckAt,
    };
  }

  // Falling back to shared?
  const shared = getSharedFromEnv();
  if (hasUsableCreds(shared)) {
    return {
      connected: true,
      source: "shared",
      phoneNumberId: shared.phoneNumberId,
      displayName: "ZashX (shared)",
      connectionType: "shared",
      connectedAt: null,
      healthStatus: "healthy",
      lastHealthCheckAt: null,
    };
  }

  return {
    connected: false,
    source: "none",
    phoneNumberId: null,
    displayName: null,
    connectionType: null,
    connectedAt: null,
    healthStatus: null,
    lastHealthCheckAt: null,
  };
}
