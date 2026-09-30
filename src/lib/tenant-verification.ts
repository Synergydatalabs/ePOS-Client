// =============================================================================
// Phase I #4 (2026-09-11) — Tenant verification service.
//
// Owns the OTP lifecycle for the tenant approval flow: generate 6-digit
// code, send via the right channel, verify with attempt + expiry checks,
// enforce resend rate limits, and stamp the verification row on success.
//
// All flows are fire-and-forget from the caller's perspective: on send
// success we return { ok: true, tokenId }; on failure { ok: false,
// reason }. Never throws — the signup + verify endpoints translate the
// reason into a customer-safe error.
//
// Channels:
//   'email' → SES via a dedicated OTP template
//   'phone' → WhatsApp first (existing sendWhatsApp), SMS fallback (existing
//             sendSms) on WhatsApp failure or when Meta creds aren't
//             configured. The transport actually used is recorded on the
//             token row so support can see it later.
//
// Rate limits (per tenant, per channel):
//   - Max 3 resends per hour
//   - Max 5 verify attempts per code (attemptsLeft on the token row)
//   - Codes expire 10 minutes after creation
//
// The service does NOT flip tenant.status — that's admin-app territory.
// It only writes email_verified_at / phone_verified_at on
// tenant_verifications and returns success to the caller, which decides
// what to do next (usually redirect the applicant to the next step).
// =============================================================================

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import prisma from "@/lib/prisma";
import { sendWhatsApp } from "@/lib/whatsapp/client";
import { WHATSAPP_TEMPLATES } from "@/lib/whatsapp/templates";
import { sendSms } from "@/lib/sms/client";

// ---- Config ---------------------------------------------------------------
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS_PER_CODE = 5;
const MAX_RESENDS_PER_HOUR = 3;
const OTP_FROM_EMAIL =
  process.env.SES_OTP_FROM_EMAIL ||
  process.env.SES_INVOICE_FROM_EMAIL ||
  process.env.SES_FROM_EMAIL ||
  "noreply@synergydatalabs.com";
const OTP_FROM_LABEL = "hub by Synergy Data Labs";

const ses = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });

// ---- Types ----------------------------------------------------------------
export type VerificationChannel = "email" | "phone";
export type VerificationTransport = "ses" | "whatsapp" | "sms";

export interface SendOtpResult {
  ok: boolean;
  tokenId?: string;
  transport?: VerificationTransport;
  reason?:
    | "rate-limited"
    | "no-destination"
    | "send-failed"
    | "internal";
  retryAfterSeconds?: number;
}

export interface VerifyOtpResult {
  ok: boolean;
  reason?:
    | "no-active-code"
    | "expired"
    | "wrong-code"
    | "no-attempts-left"
    | "already-verified"
    | "internal";
  attemptsLeft?: number;
}

// ---- Helpers --------------------------------------------------------------

/** 6-digit numeric OTP. Cryptographic randomness is overkill for a
 *  10-minute single-use code; Math.random with a wide range is fine. */
function generateOtp(): string {
  const min = 10 ** (OTP_LENGTH - 1);
  const max = 10 ** OTP_LENGTH;
  return String(Math.floor(Math.random() * (max - min)) + min);
}

/** Enforce the resend rate limit before minting a new code. Counts
 *  tokens created in the last hour for this (tenant, channel). */
async function checkResendRateLimit(
  tenantId: string,
  channel: VerificationChannel
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await prisma.tenantVerificationToken.findMany({
    where: {
      tenantId,
      channel,
      createdAt: { gte: oneHourAgo },
    },
    select: { createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  if (recent.length < MAX_RESENDS_PER_HOUR) return { ok: true };
  // Oldest in window falls off first — that's when we're back under cap.
  const oldest = recent[0]!.createdAt.getTime();
  const backUnderCapAt = oldest + 60 * 60 * 1000;
  const retryAfterSeconds = Math.max(1, Math.ceil((backUnderCapAt - Date.now()) / 1000));
  return { ok: false, retryAfterSeconds };
}

/** Invalidate any un-consumed codes for this (tenant, channel) so a
 *  freshly-issued OTP is the only one that verifies. Also runs on send
 *  so a resend supersedes an in-flight code. */
async function invalidateLiveTokens(
  tenantId: string,
  channel: VerificationChannel
): Promise<void> {
  await prisma.tenantVerificationToken.updateMany({
    where: { tenantId, channel, consumedAt: null },
    data: { attemptsLeft: 0 }, // burns the code, keeps the row for audit
  });
}

// ---- Send: email ----------------------------------------------------------

async function sendEmailOtp(
  destination: string,
  code: string,
  tenantName: string
): Promise<{ ok: boolean; error?: string }> {
  const subject = `Your ${OTP_FROM_LABEL} verification code: ${code}`;
  const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F5F7F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:24px 16px;">
    <div style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #E5E7EB;text-align:center;">
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#6b7280;">${OTP_FROM_LABEL}</p>
      <h1 style="margin:0 0 24px;font-size:22px;color:#111827;">Verify your email</h1>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.5;">
        Enter this code to finish setting up <strong>${tenantName}</strong>.
      </p>
      <div style="display:inline-block;padding:16px 28px;background:#0E2145;border-radius:12px;">
        <span style="font-family:'Courier New',monospace;font-size:32px;font-weight:700;color:#ffffff;letter-spacing:0.25em;">${code}</span>
      </div>
      <p style="margin:24px 0 0;color:#6b7280;font-size:13px;">
        This code expires in ${OTP_EXPIRY_MINUTES} minutes.
      </p>
      <p style="margin:16px 0 0;color:#9ca3af;font-size:12px;">
        Didn't request this? You can safely ignore this email.
      </p>
    </div>
  </div>
</body></html>`;
  const textBody = `Verify your email — ${OTP_FROM_LABEL}

Enter this code to finish setting up ${tenantName}:

    ${code}

This code expires in ${OTP_EXPIRY_MINUTES} minutes.
Didn't request this? You can ignore this email.
`;
  try {
    await ses.send(
      new SendEmailCommand({
        Source: `${OTP_FROM_LABEL} <${OTP_FROM_EMAIL}>`,
        Destination: { ToAddresses: [destination] },
        Message: {
          Subject: { Data: subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: htmlBody, Charset: "UTF-8" },
            Text: { Data: textBody, Charset: "UTF-8" },
          },
        },
      })
    );
    return { ok: true };
  } catch (err: any) {
    console.error("[tenant-verification] SES OTP send failed:", err?.message || err);
    return { ok: false, error: err?.message || "SES send failed" };
  }
}

// ---- Send: phone (WhatsApp first, SMS fallback) --------------------------

async function sendPhoneOtp(
  tenantId: string,
  destination: string,
  code: string
): Promise<{ ok: boolean; transport?: VerificationTransport; error?: string }> {
  const body = `Your hub verification code: ${code}\nExpires in ${OTP_EXPIRY_MINUTES} minutes.\nDidn't request this? Ignore this message.`;

  // Phase I #4 (2026-09-12): OTP uses an AUTHENTICATION-category
  // template so Meta delivers to recipients who've never messaged the
  // WABA before (free-form text only works inside the 24h customer
  // window — useless for brand-new signups). Template must be
  // pre-approved in Meta Business Manager; see WHATSAPP_TEMPLATES.SIGNUP_OTP.
  try {
    const wa = await sendWhatsApp({
      kind: "template",
      tenantId,
      to: destination,
      templateName: WHATSAPP_TEMPLATES.SIGNUP_OTP.name,
      languageCode: WHATSAPP_TEMPLATES.SIGNUP_OTP.languageCode,
      parameters: [code],
      // Phase I #4 (2026-09-12): zashxauthotp1 (the shared OTP template)
      // carries a URL "Copy code" button whose parameter is the code
      // itself — tap-to-copy on the recipient's phone. Meta rejects the
      // send with 131008 if we omit this.
      urlButtonParameter: code,
      category: "verification",
    });
    if (wa.ok) return { ok: true, transport: "whatsapp" };
    console.warn(
      `[tenant-verification] WhatsApp OTP template failed for tenant ${tenantId}: ${wa.error || wa.provider} — falling back to SMS`
    );
  } catch (err: any) {
    console.warn(
      `[tenant-verification] WhatsApp OTP threw for tenant ${tenantId}: ${err?.message || err} — falling back to SMS`
    );
  }

  // Fall back to SMS.
  try {
    const sms = await sendSms({
      tenantId,
      to: destination,
      body,
      category: "verification",
    });
    if (sms.ok) return { ok: true, transport: "sms" };
    return { ok: false, transport: "sms", error: sms.error || sms.provider };
  } catch (err: any) {
    return { ok: false, transport: "sms", error: err?.message || "SMS send failed" };
  }
}

// ---- Public API -----------------------------------------------------------

/**
 * Ensure a tenant_verifications row exists for this tenant. Called at
 * signup time. Idempotent — no-op if a row is already present.
 */
export async function ensureVerificationRow(
  tenantId: string,
  contactEmail: string,
  contactPhone: string | null
): Promise<void> {
  await prisma.tenantVerification.upsert({
    where: { tenantId },
    update: {
      // Refresh contact on update in case the applicant fixed a typo on
      // re-signup (rare — usually a new tenant). Don't clear verified
      // timestamps.
      contactEmail: contactEmail.trim().toLowerCase().slice(0, 255),
      contactPhone: contactPhone?.trim().slice(0, 40) ?? null,
    },
    create: {
      tenantId,
      contactEmail: contactEmail.trim().toLowerCase().slice(0, 255),
      contactPhone: contactPhone?.trim().slice(0, 40) ?? null,
    },
  });
}

/**
 * Issue an OTP for the given (tenant, channel). Enforces rate limit,
 * invalidates any prior live code for the same channel, sends the code,
 * and records the token row. `destination` is inferred from the
 * verification row (contact_email or contact_phone) — pass null to
 * force the caller to specify (used by resend where address may have
 * been edited).
 */
export async function sendOtp(
  tenantId: string,
  channel: VerificationChannel
): Promise<SendOtpResult> {
  try {
    const verification = await prisma.tenantVerification.findUnique({
      where: { tenantId },
      select: {
        contactEmail: true,
        contactPhone: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
      },
    });
    if (!verification) return { ok: false, reason: "internal" };

    const destination =
      channel === "email" ? verification.contactEmail : verification.contactPhone;
    if (!destination) return { ok: false, reason: "no-destination" };

    // Rate limit
    const rl = await checkResendRateLimit(tenantId, channel);
    if (!rl.ok) {
      return { ok: false, reason: "rate-limited", retryAfterSeconds: rl.retryAfterSeconds };
    }

    // Kill any prior live code so verify only accepts the fresh one
    await invalidateLiveTokens(tenantId, channel);

    // Mint
    const code = generateOtp();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Send
    let transport: VerificationTransport;
    let sent: { ok: boolean; error?: string; transport?: VerificationTransport };
    if (channel === "email") {
      // Look up a tenant name for the email body — best-effort.
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true },
      });
      sent = await sendEmailOtp(destination, code, tenant?.name || "your account");
      transport = "ses";
    } else {
      sent = await sendPhoneOtp(tenantId, destination, code);
      transport = sent.transport || "sms";
    }
    if (!sent.ok) {
      console.error(
        `[tenant-verification] send failed tenant=${tenantId} channel=${channel}: ${sent.error}`
      );
      return { ok: false, reason: "send-failed" };
    }

    // Record — only after the send succeeded, so a failed send doesn't
    // burn a resend slot.
    const token = await prisma.tenantVerificationToken.create({
      data: {
        tenantId,
        channel,
        transport,
        destination: destination.slice(0, 255),
        code,
        expiresAt,
        attemptsLeft: MAX_ATTEMPTS_PER_CODE,
      },
      select: { id: true },
    });
    return { ok: true, tokenId: token.id, transport };
  } catch (err: any) {
    console.error("[tenant-verification] sendOtp error:", err);
    return { ok: false, reason: "internal" };
  }
}

/**
 * Verify a code the applicant just typed. Consumes the code on success
 * (single-use), decrements attemptsLeft on wrong code, refuses expired
 * or exhausted codes. On success, stamps email_verified_at OR
 * phone_verified_at on the verification row.
 */
export async function verifyOtp(
  tenantId: string,
  channel: VerificationChannel,
  submittedCode: string
): Promise<VerifyOtpResult> {
  try {
    const trimmed = submittedCode.trim();
    if (!trimmed) return { ok: false, reason: "wrong-code" };

    // Idempotency — if already verified, tell the caller so they can
    // move to the next step in the flow without erroring out.
    const verification = await prisma.tenantVerification.findUnique({
      where: { tenantId },
      select: { emailVerifiedAt: true, phoneVerifiedAt: true },
    });
    if (!verification) return { ok: false, reason: "internal" };
    if (channel === "email" && verification.emailVerifiedAt) {
      return { ok: true, reason: "already-verified" };
    }
    if (channel === "phone" && verification.phoneVerifiedAt) {
      return { ok: true, reason: "already-verified" };
    }

    // Latest live code for this (tenant, channel).
    const token = await prisma.tenantVerificationToken.findFirst({
      where: { tenantId, channel, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!token) return { ok: false, reason: "no-active-code" };
    if (token.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
    if (token.attemptsLeft <= 0) return { ok: false, reason: "no-attempts-left" };

    if (token.code !== trimmed) {
      const nextAttempts = token.attemptsLeft - 1;
      await prisma.tenantVerificationToken.update({
        where: { id: token.id },
        data: { attemptsLeft: nextAttempts },
      });
      return {
        ok: false,
        reason: nextAttempts <= 0 ? "no-attempts-left" : "wrong-code",
        attemptsLeft: nextAttempts,
      };
    }

    // Match — consume token + stamp verification row atomically.
    const now = new Date();
    await prisma.$transaction([
      prisma.tenantVerificationToken.update({
        where: { id: token.id },
        data: { consumedAt: now, attemptsLeft: 0 },
      }),
      prisma.tenantVerification.update({
        where: { tenantId },
        data:
          channel === "email"
            ? { emailVerifiedAt: now }
            : { phoneVerifiedAt: now },
      }),
    ]);
    return { ok: true };
  } catch (err: any) {
    console.error("[tenant-verification] verifyOtp error:", err);
    return { ok: false, reason: "internal" };
  }
}

/** Whole-picture status for the applicant's UI. Called by the login-time
 *  layout guard to decide what to render (verify-email vs verify-phone
 *  vs under-review vs rejected). */
export async function getVerificationStatus(
  tenantId: string
): Promise<{
  hasRow: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  adminDecision: string | null;
  rejectionReason: string | null;
}> {
  const v = await prisma.tenantVerification.findUnique({
    where: { tenantId },
    select: {
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      contactEmail: true,
      contactPhone: true,
      adminDecision: true,
      rejectionReason: true,
    },
  });
  if (!v) {
    // Grandfathered tenant (created before Phase I #4) — no row exists,
    // and status is ACTIVE. Report all-clear so the layout guard treats
    // them as fully verified.
    return {
      hasRow: false,
      emailVerified: true,
      phoneVerified: true,
      contactEmail: null,
      contactPhone: null,
      adminDecision: "approved",
      rejectionReason: null,
    };
  }
  return {
    hasRow: true,
    emailVerified: !!v.emailVerifiedAt,
    phoneVerified: !!v.phoneVerifiedAt,
    contactEmail: v.contactEmail,
    contactPhone: v.contactPhone,
    adminDecision: v.adminDecision,
    rejectionReason: v.rejectionReason,
  };
}
