// POST /api/partner/auth/verify
//
// Phase I #4 (2026-09-11) — one endpoint that handles the three
// applicant-side verification actions:
//
//   { action: "verify",  channel: "email"|"phone", code: "123456" }
//     → validate the OTP + mark <channel>_verified_at
//
//   { action: "resend",  channel: "email"|"phone" }
//     → invalidate any live code for that channel + mint + send a fresh one
//
//   { action: "status" }
//     → return the current verification state so the /partner/verify page
//        can decide what to render (verify-email step vs verify-phone step
//        vs under-review vs rejected)
//
// Auth: partner JWT required. The tenant is inferred from the session —
// applicants can only verify THEIR OWN tenant's codes, never someone
// else's. Guards against a hijacked session by re-loading the tenant
// row and confirming it hasn't been deleted or reassigned since login.
//
// Rate limit: enforced by the service layer (3 resends/hr + 5 attempts
// per code). This route just surfaces the reason to the client.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import {
  sendOtp,
  verifyOtp,
  getVerificationStatus,
  type VerificationChannel,
} from "@/lib/tenant-verification";

type Action = "verify" | "resend" | "status" | "update-destination";

function isChannel(x: unknown): x is VerificationChannel {
  return x === "email" || x === "phone";
}

export async function POST(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    // Re-load tenant from DB — the session's tenantId comes from a JWT
    // that could outlive the tenant (deleted after issue). Also gives us
    // the current status so we can short-circuit obvious cases.
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { id: true, status: true },
    });
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const action = (body.action as Action) || "status";

    // ---- status --------------------------------------------------------
    // Cheap — just reads the verification row. Called by the client
    // verify page on mount + after every action to decide what to render.
    if (action === "status") {
      const status = await getVerificationStatus(tenant.id);
      return NextResponse.json({
        success: true,
        tenantStatus: tenant.status,
        ...status,
      });
    }

    // ---- verify --------------------------------------------------------
    if (action === "verify") {
      if (!isChannel(body.channel)) {
        return NextResponse.json(
          { error: "channel must be 'email' or 'phone'" },
          { status: 400 }
        );
      }
      const code = typeof body.code === "string" ? body.code : "";
      const result = await verifyOtp(tenant.id, body.channel, code);
      if (!result.ok) {
        const msg = friendlyVerifyReason(result.reason, result.attemptsLeft);
        return NextResponse.json(
          { error: msg, reason: result.reason, attemptsLeft: result.attemptsLeft },
          { status: 400 }
        );
      }
      // Success — return the updated status so the client can advance to
      // the next step in the flow without a second round trip.
      const status = await getVerificationStatus(tenant.id);
      return NextResponse.json({
        success: true,
        tenantStatus: tenant.status,
        ...status,
      });
    }

    // ---- update-destination -------------------------------------------
    // Phase I #4 (2026-09-12): applicant mistyped their phone (or email)
    // at signup and can't receive the OTP. Let them fix it here — same
    // pattern zashx-app already uses. Only allowed while the tenant is
    // still PENDING_APPROVAL; once approved, contact changes go through
    // the settings UI so the audit trail is on the tenant-owner, not
    // an anonymous verify session.
    if (action === "update-destination") {
      if (tenant.status !== "PENDING_APPROVAL") {
        return NextResponse.json(
          { error: "Contact details can only be changed before approval" },
          { status: 403 }
        );
      }
      if (!isChannel(body.channel)) {
        return NextResponse.json(
          { error: "channel must be 'email' or 'phone'" },
          { status: 400 }
        );
      }
      const rawValue = typeof body.value === "string" ? body.value.trim() : "";
      if (!rawValue) {
        return NextResponse.json({ error: "New value is required" }, { status: 400 });
      }

      let normalized: string;
      if (body.channel === "email") {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawValue)) {
          return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
        }
        normalized = rawValue.toLowerCase().slice(0, 255);
      } else {
        // Phone: strip formatting, keep digits only — matches what the
        // signup endpoint stores and what WhatsApp/SMS senders expect.
        normalized = rawValue.replace(/\D/g, "").slice(0, 40);
        if (normalized.length < 7) {
          return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
        }
      }

      // Reset the verified timestamp for this channel — a new
      // destination needs a fresh round of proof — and clear any live
      // tokens so an old code can't be re-used against the new number.
      // The updateMany on tokens is the simplest way to invalidate; the
      // service layer's invalidateLiveTokens is private.
      await prisma.$transaction([
        prisma.tenantVerification.update({
          where: { tenantId: tenant.id },
          data:
            body.channel === "email"
              ? { contactEmail: normalized, emailVerifiedAt: null }
              : { contactPhone: normalized, phoneVerifiedAt: null },
        }),
        // Mark any live tokens for this channel as consumed so they
        // can't be used against the new destination. The schema has no
        // dedicated "invalidated" flag — consumedAt does the same job
        // (verify treats consumed tokens as unusable).
        prisma.tenantVerificationToken.updateMany({
          where: {
            tenantId: tenant.id,
            channel: body.channel,
            consumedAt: null,
          },
          data: { consumedAt: new Date() },
        }),
      ]);

      // Fire a fresh OTP to the new destination. If sending fails
      // (rate-limited etc.) we still return the updated status so the
      // page rerenders with the new number — the user can hit Resend.
      const sendResult = await sendOtp(tenant.id, body.channel);
      const status = await getVerificationStatus(tenant.id);
      return NextResponse.json({
        success: true,
        tenantStatus: tenant.status,
        ...status,
        sendOk: sendResult.ok,
        sendReason: sendResult.ok ? undefined : sendResult.reason,
        transport: sendResult.ok ? sendResult.transport : undefined,
      });
    }

    // ---- resend --------------------------------------------------------
    if (action === "resend") {
      if (!isChannel(body.channel)) {
        return NextResponse.json(
          { error: "channel must be 'email' or 'phone'" },
          { status: 400 }
        );
      }
      const result = await sendOtp(tenant.id, body.channel);
      if (!result.ok) {
        const msg = friendlyResendReason(result.reason, result.retryAfterSeconds);
        const status =
          result.reason === "rate-limited" ? 429 :
          result.reason === "no-destination" ? 400 :
          502;
        return NextResponse.json(
          { error: msg, reason: result.reason, retryAfterSeconds: result.retryAfterSeconds },
          { status }
        );
      }
      return NextResponse.json({
        success: true,
        transport: result.transport,
      });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("[partner/auth/verify] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// Also accept GET for the status action so the client verify page can
// use a plain fetch() on mount without needing to POST an empty body.
export async function GET(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { id: true, status: true },
    });
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    const status = await getVerificationStatus(tenant.id);
    return NextResponse.json({
      success: true,
      tenantStatus: tenant.status,
      ...status,
    });
  } catch (err: any) {
    console.error("[partner/auth/verify GET] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

function friendlyVerifyReason(
  reason: string | undefined,
  attemptsLeft: number | undefined
): string {
  switch (reason) {
    case "wrong-code":
      return attemptsLeft && attemptsLeft > 0
        ? `That code isn't right — ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left. Double-check and try again.`
        : "That code isn't right. Request a new one below.";
    case "expired":
      return "This code has expired. Request a new one below.";
    case "no-active-code":
      return "No active code — request a new one below.";
    case "no-attempts-left":
      return "Too many wrong attempts. Request a new code to try again.";
    case "already-verified":
      return "This is already verified.";
    default:
      return "Could not verify — please request a new code and try again.";
  }
}

function friendlyResendReason(
  reason: string | undefined,
  retryAfterSeconds: number | undefined
): string {
  switch (reason) {
    case "rate-limited": {
      const mins = retryAfterSeconds ? Math.max(1, Math.ceil(retryAfterSeconds / 60)) : 60;
      return `Too many requests — try again in about ${mins} minute${mins === 1 ? "" : "s"}.`;
    }
    case "no-destination":
      return "No email or phone on file for this account — contact support.";
    case "send-failed":
      return "Couldn't send the code — try again in a moment.";
    default:
      return "Could not send a new code — please try again.";
  }
}
