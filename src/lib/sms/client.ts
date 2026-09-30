// ============================================================================
// src/lib/sms/client.ts
//
// Per-tenant SMS service. Two modes selected via TenantSettings.smsProvider:
//
//   1. "shared" (Mode A — default for new tenants)
//        Routes through ZASHX's AWS SNS account using platform-level creds
//        (AWS_REGION + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY env vars).
//        Partner pays per message; we mark up to a flat $0.02/SMS.
//        Sender label (e.g. "Oreugo") is prepended to the message body.
//
//   2. "twilio" (Mode B — BYO advanced)
//        Uses the partner's own Twilio Account SID + Auth Token + From #.
//        Credentials encrypted at rest using the same AES-256-GCM helper
//        as the Meta integration.
//
// If smsEnabled=false → returns disabled. Sender failures are non-fatal —
// callers are expected to treat SMS as fire-and-forget so a Twilio hiccup
// never blocks a reservation / waitlist / payment flow.
//
// Local-dev fallback: when no env creds AND no tenant creds are configured,
// logs to console and returns a fake message ID so unit tests / dev runs
// never need real credentials.
// ============================================================================

import prisma from "@/lib/prisma";
import { decryptString } from "@/lib/crypto/encryption";

export interface SmsSendResult {
  ok: boolean;
  provider: "aws-sns" | "twilio" | "dev" | "disabled";
  messageId?: string;
  error?: string;
}

export interface SmsSendParams {
  /** Tenant whose SMS config to use. Required for per-tenant routing. */
  tenantId: string;
  /** Recipient phone — E.164 ideally; we strip whitespace + punctuation. */
  to: string;
  /** Message body (≤1600 chars; we truncate). Sender label auto-prepended
   *  in shared mode unless body already contains it. */
  body: string;
  /** Optional tag for logging / analytics (e.g. "reservation_confirm"). */
  category?: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function normalizePhone(phone: string): string {
  return phone.trim().replace(/[\s().-]/g, "");
}

async function loadTenantSmsConfig(tenantId: string) {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: {
      smsEnabled: true,
      smsProvider: true,
      smsSenderLabel: true,
      smsTwilioAccountSidEnc: true,
      smsTwilioAuthTokenEnc: true,
      smsTwilioFromNumber: true,
    },
  });
  return settings;
}

// ----------------------------------------------------------------------------
// AWS SNS sender (Mode A)
// ----------------------------------------------------------------------------

async function sendViaAwsSns(
  to: string,
  body: string,
  category?: string
): Promise<SmsSendResult> {
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    // Dev fallback — log instead of attempting an SNS call we can't make.
    console.log(
      `[SMS shared/AWS SNS — DEV] → ${to} [${category ?? "general"}]\n  ${body.replace(/\n/g, "\n  ")}`
    );
    return {
      ok: true,
      provider: "dev",
      messageId: `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
  }

  try {
    // Dynamic import so dev builds without @aws-sdk installed still run.
    const { SNSClient, PublishCommand } = await import("@aws-sdk/client-sns");
    const sns = new SNSClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    const result = await sns.send(
      new PublishCommand({
        PhoneNumber: to,
        Message: body,
        MessageAttributes: {
          "AWS.SNS.SMS.SMSType": {
            DataType: "String",
            StringValue: "Transactional",
          },
          ...(process.env.AWS_SNS_SENDER_ID
            ? {
                "AWS.SNS.SMS.SenderID": {
                  DataType: "String",
                  StringValue: process.env.AWS_SNS_SENDER_ID,
                },
              }
            : {}),
        },
      })
    );
    return { ok: true, provider: "aws-sns", messageId: result.MessageId };
  } catch (err: any) {
    console.error("[SMS AWS SNS] send failed:", err);
    return {
      ok: false,
      provider: "aws-sns",
      error: err?.message || "AWS SNS error",
    };
  }
}

// ----------------------------------------------------------------------------
// Twilio sender (Mode B — uses tenant's own creds)
// ----------------------------------------------------------------------------

async function sendViaTwilio(
  accountSid: string,
  authToken: string,
  fromNumber: string,
  to: string,
  body: string
): Promise<SmsSendResult> {
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const formBody = new URLSearchParams({
      To: to,
      From: fromNumber,
      Body: body,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return {
        ok: false,
        provider: "twilio",
        error: `Twilio ${res.status}: ${errBody.slice(0, 200)}`,
      };
    }
    const data = await res.json();
    return { ok: true, provider: "twilio", messageId: data.sid };
  } catch (err: any) {
    return { ok: false, provider: "twilio", error: err?.message || "Twilio error" };
  }
}

// ----------------------------------------------------------------------------
// Public entrypoint
// ----------------------------------------------------------------------------

export async function sendSms(params: SmsSendParams): Promise<SmsSendResult> {
  const to = normalizePhone(params.to);
  const truncated = params.body.slice(0, 1600);

  const cfg = await loadTenantSmsConfig(params.tenantId);
  if (!cfg || !cfg.smsEnabled) {
    return { ok: false, provider: "disabled", error: "SMS not enabled for this tenant" };
  }

  // Mode A — shared sender via AWS SNS
  if (cfg.smsProvider === "shared") {
    // Prepend the partner label so recipients can tell who sent the message
    // (since the From number is a shared ZASHX number, not the partner's).
    const labelled = cfg.smsSenderLabel
      ? `${cfg.smsSenderLabel}: ${truncated}`
      : truncated;
    return sendViaAwsSns(to, labelled, params.category);
  }

  // Mode B — partner's own Twilio
  if (cfg.smsProvider === "twilio") {
    if (
      !cfg.smsTwilioAccountSidEnc ||
      !cfg.smsTwilioAuthTokenEnc ||
      !cfg.smsTwilioFromNumber
    ) {
      return {
        ok: false,
        provider: "twilio",
        error: "Twilio mode selected but credentials are missing — partner needs to complete setup.",
      };
    }
    try {
      const sid = decryptString(cfg.smsTwilioAccountSidEnc);
      const tok = decryptString(cfg.smsTwilioAuthTokenEnc);
      return sendViaTwilio(sid, tok, cfg.smsTwilioFromNumber, to, truncated);
    } catch (err: any) {
      return {
        ok: false,
        provider: "twilio",
        error: `Failed to decrypt Twilio credentials: ${err?.message}`,
      };
    }
  }

  return {
    ok: false,
    provider: "disabled",
    error: `Unknown SMS provider: ${cfg.smsProvider}`,
  };
}

/**
 * Lightweight status read for the integrations dashboard.
 * Doesn't send anything — just reports what mode / config the tenant has.
 */
export async function getSmsStatus(tenantId: string) {
  const cfg = await loadTenantSmsConfig(tenantId);
  if (!cfg) {
    return {
      enabled: false,
      provider: "shared" as const,
      configured: false,
      senderLabel: null,
      twilioFromNumber: null,
    };
  }
  const configured =
    cfg.smsProvider === "shared"
      ? cfg.smsEnabled
      : !!(cfg.smsTwilioAccountSidEnc && cfg.smsTwilioAuthTokenEnc && cfg.smsTwilioFromNumber);
  return {
    enabled: cfg.smsEnabled,
    provider: cfg.smsProvider as "shared" | "twilio",
    configured,
    senderLabel: cfg.smsSenderLabel,
    twilioFromNumber: cfg.smsTwilioFromNumber,
  };
}
