// ============================================================================
// src/lib/whatsapp/client.ts
//
// WhatsApp Business via Meta Cloud API. Same shape as SMS service:
//   - Real send when META_WHATSAPP_* env vars set
//   - Dev mode (console log) as fallback
//   - Disabled via WHATSAPP_ENABLED=false
//
// MULTI-TENANT NOTE (Phase 5d):
//   Credentials resolution lives in src/lib/whatsapp/credentials.ts.
//   Per-tenant BYO credentials (stored encrypted in tenants.meta_*_enc
//   columns) take precedence over the shared env-var fallback. The
//   `source` tag in the result lets us trace WHICH credential set was
//   used per send for billing/debugging.
//
// MESSAGE TYPES:
//   - Free-form text: only allowed within 24h of an inbound message from the
//     user. Used for replies to incoming messages.
//   - Pre-approved template: required for outbound to users who haven't
//     messaged you in 24h (almost all reservation confirmations fit here).
//     Templates must be approved by Meta before use (1-3 days).
//
// For Phase 5c, we send templates by name with placeholder values.
// ============================================================================

import {
  resolveMetaCredentialsForTenant,
  type ResolvedMetaCredentials,
} from "./credentials";

export interface WhatsAppSendResult {
  ok: boolean;
  provider: "meta" | "dev" | "disabled";
  /** Which credential set sent it — "tenant" (BYO) or "shared" (platform env). */
  credentialSource?: "tenant" | "shared";
  messageId?: string;
  error?: string;
}

export type WhatsAppSendParams =
  | WhatsAppFreeFormParams
  | WhatsAppTemplateParams;

export interface WhatsAppFreeFormParams {
  kind: "text";
  tenantId: string;       // for future per-tenant credentials lookup
  to: string;             // E.164 ideally (no leading +, e.g. "14165551234")
  body: string;           // max 4096 chars (Meta limit; we don't truncate — caller's responsibility)
  category?: string;
}

export interface WhatsAppTemplateParams {
  kind: "template";
  tenantId: string;
  to: string;
  templateName: string;   // must match name registered in Meta Business Manager
  languageCode?: string;  // default "en_US"
  /**
   * Body parameter values — order MUST match template's {{1}}, {{2}} placeholders.
   * Example: template "Hello {{1}}, your booking on {{2}} is confirmed."
   *   parameters: ["Sarah", "March 15"]
   */
  parameters?: string[];
  /**
   * Phase I #4 (2026-09-12): Meta AUTHENTICATION templates registered with
   * a URL "copy-code" button require a button parameter (the code itself,
   * so tap-to-copy on the recipient's phone drops it into the OTP input).
   * Without this, Meta returns 131008 "buttons: Button at index 0 of
   * type Url requires a parameter". Only set for templates that actually
   * have a URL button in Meta.
   */
  urlButtonParameter?: string;
  category?: string;
}

interface WhatsAppConfig {
  enabled: boolean;
  fallbackToDev: boolean;
}

function getConfig(): WhatsAppConfig {
  return {
    enabled: (process.env.WHATSAPP_ENABLED || "true").toLowerCase() !== "false",
    fallbackToDev: (process.env.WHATSAPP_DEV_FALLBACK || "true").toLowerCase() !== "false",
  };
}

/**
 * Normalize phone for WhatsApp. Meta expects digits only (no + prefix, no spaces).
 * Examples accepted: "+1 (416) 555-1234", "14165551234", "(416) 555-1234"
 * All become "14165551234"
 */
function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Main send function. Routes to free-form text or template send based on kind.
 * Always returns a result — never throws (call-site decides what to do).
 */
export async function sendWhatsApp(
  params: WhatsAppSendParams
): Promise<WhatsAppSendResult> {
  const config = getConfig();

  if (!config.enabled) {
    return { ok: false, provider: "disabled", error: "WHATSAPP_ENABLED=false" };
  }

  const creds: ResolvedMetaCredentials | null = await resolveMetaCredentialsForTenant(
    params.tenantId
  );

  // Dev mode — no usable creds anywhere
  if (!creds) {
    if (!config.fallbackToDev) {
      return {
        ok: false,
        provider: "disabled",
        error: "No Meta credentials (tenant or shared) and WHATSAPP_DEV_FALLBACK=false",
      };
    }
    if (params.kind === "text") {
      console.log(
        `[WHATSAPP DEV] tenant=${params.tenantId.slice(0, 8)} → ${normalizePhone(params.to)} [${params.category ?? "general"}]\n  ${params.body.replace(/\n/g, "\n  ")}`
      );
    } else {
      console.log(
        `[WHATSAPP DEV] tenant=${params.tenantId.slice(0, 8)} → ${normalizePhone(params.to)} TEMPLATE=${params.templateName}(${(params.parameters ?? []).join(", ")})`
      );
    }
    return {
      ok: true,
      provider: "dev",
      messageId: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  // Real Meta API call
  const url = `https://graph.facebook.com/v21.0/${creds.phoneNumberId}/messages`;
  const to = normalizePhone(params.to);

  let body: Record<string, any>;
  if (params.kind === "text") {
    body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: params.body, preview_url: false },
    };
  } else {
    // Phase I #4 (2026-09-12): assemble components dynamically so
    // AUTHENTICATION templates with a copy-code URL button (e.g.
    // zashxauthotp1) get their button parameter. Without the button
    // component Meta returns 131008 "buttons: Button at index 0 of
    // type Url requires a parameter".
    const components: Array<Record<string, unknown>> = [];
    if (params.parameters && params.parameters.length > 0) {
      components.push({
        type: "body",
        parameters: params.parameters.map((p) => ({ type: "text", text: p })),
      });
    }
    if (params.urlButtonParameter) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: params.urlButtonParameter }],
      });
    }
    body = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: params.templateName,
        language: { code: params.languageCode || "en_US" },
        ...(components.length > 0 ? { components } : {}),
      },
    };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.error(
        `[WhatsApp Meta] send failed (source=${creds.source}):`,
        res.status,
        errBody
      );
      return {
        ok: false,
        provider: "meta",
        credentialSource: creds.source === "tenant" ? "tenant" : "shared",
        error: `Meta ${res.status}: ${errBody.slice(0, 300)}`,
      };
    }

    const data = await res.json();
    const messageId = data?.messages?.[0]?.id;
    return {
      ok: true,
      provider: "meta",
      credentialSource: creds.source === "tenant" ? "tenant" : "shared",
      messageId,
    };
  } catch (err: any) {
    console.error("[WhatsApp Meta] exception:", err);
    return {
      ok: false,
      provider: "meta",
      credentialSource: creds.source === "tenant" ? "tenant" : "shared",
      error: err?.message || "Unknown Meta error",
    };
  }
}

/**
 * Quick health-check (no actual API call, no per-tenant lookup) — used
 * by platform-level UI status badges. For per-tenant status see
 * getTenantWhatsAppStatus() in ./credentials.
 */
export function getWhatsAppStatus(): {
  mode: "meta" | "dev" | "disabled";
  ready: boolean;
} {
  const config = getConfig();
  if (!config.enabled) return { mode: "disabled", ready: false };
  const hasShared = Boolean(
    process.env.META_WHATSAPP_PHONE_NUMBER_ID &&
      process.env.META_WHATSAPP_ACCESS_TOKEN
  );
  if (hasShared) return { mode: "meta", ready: true };
  return { mode: "dev", ready: config.fallbackToDev };
}
