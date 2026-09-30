"use client";

// /partner/verify — post-signup verification wizard.
//
// Phase I #4 (2026-09-11). New tenants land here after signing up. The
// page reads the tenant's verification status from
// /api/partner/auth/verify?action=status and renders one of five states:
//
//   1. email-pending   — 6-digit input for the email OTP, resend button
//   2. phone-pending   — 6-digit input for the phone OTP, resend button
//                        (skipped entirely when no phone was captured)
//   3. under-review    — both verified, waiting for admin to approve
//   4. rejected        — admin rejected; shows reason + support contact
//   5. approved        — never rendered here; a redirect kicks in from
//                        the layout guard so this page only runs while
//                        tenant.status !== 'ACTIVE'
//
// Kept a single file (rather than one per step) so state transitions are
// synchronous — after verifying the email, the same page re-reads status
// and flips to the phone step or the review screen without a route
// change. Less flicker, less code.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface Status {
  tenantStatus: string;         // 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | ...
  hasRow: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  adminDecision: string | null;
  rejectionReason: string | null;
}

const BRAND_BLUE = "#006AFF";
const BRAND_NAVY = "#0E2145";
const BRAND_INK = "#0F1729";

export default function VerifyPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  // Phase I #4 (2026-09-12): inline "change phone" editor state.
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/partner/auth/verify", { cache: "no-store" });
      const data = await res.json();
      if (res.status === 401) {
        // Not signed in — bounce to login. Applicant probably reached
        // this page by URL directly without a session.
        router.replace("/partner/login");
        return;
      }
      if (!res.ok) {
        toast.error(data.error || "Could not load status");
        return;
      }
      setStatus(data);
      // If already active, no reason to sit on this page — send them home.
      if (data.tenantStatus === "ACTIVE") {
        router.replace("/partner/dashboard");
      }
    } catch {
      toast.error("Could not load status");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Which channel are we verifying right now? Email first, phone second.
  // If phone is null on the verification row (merchant signup path
  // that didn't capture phone), phone step is skipped automatically.
  const currentChannel: "email" | "phone" | null = !status
    ? null
    : !status.emailVerified
    ? "email"
    : !status.phoneVerified && status.contactPhone
    ? "phone"
    : null;

  async function submit() {
    if (!currentChannel) return;
    if (!/^\d{6}$/.test(code)) {
      toast.error("Enter the 6-digit code");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/partner/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", channel: currentChannel, code }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Verification failed");
        return;
      }
      toast.success(
        currentChannel === "email" ? "Email verified" : "Phone verified"
      );
      setCode("");
      setStatus(data); // server returned the updated status
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (!currentChannel) return;
    setResending(true);
    try {
      const res = await fetch("/api/partner/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend", channel: currentChannel }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Couldn't send a new code");
        return;
      }
      toast.success(
        currentChannel === "email"
          ? "New code sent to your email"
          : `New code sent via ${data.transport === "whatsapp" ? "WhatsApp" : "SMS"}`
      );
    } finally {
      setResending(false);
    }
  }

  // Phase I #4 (2026-09-12): "change phone" flow. Applicant realises
  // they typed the wrong number after signup — we let them fix it +
  // fire a fresh OTP to the new value. Only offered for the phone
  // channel because email typos usually surface as "code never
  // arrived, request a new signup" which is simpler.
  async function updatePhone(newPhone: string) {
    const trimmed = newPhone.trim();
    if (!trimmed) {
      toast.error("Enter a phone number");
      return false;
    }
    if (trimmed.replace(/\D/g, "").length < 7) {
      toast.error("Enter a valid phone number");
      return false;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/partner/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update-destination",
          channel: "phone",
          value: trimmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Couldn't update phone");
        return false;
      }
      setStatus(data);
      setCode("");
      setEditingPhone(false);
      setPhoneDraft("");
      if (data.sendOk) {
        toast.success(
          `New code sent via ${data.transport === "whatsapp" ? "WhatsApp" : "SMS"}`
        );
      } else {
        toast.message(
          "Phone updated — hit Resend to send a code (rate limit may apply)"
        );
      }
      return true;
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Render ---------------------------------------------------------

  if (loading) {
    return (
      <Shell>
        <p style={{ color: "#6b7280", fontSize: 14 }}>Loading…</p>
      </Shell>
    );
  }
  if (!status) return null;

  // Rejected screen — terminal state, no verify inputs.
  if (status.tenantStatus === "REJECTED" || status.adminDecision === "rejected") {
    return (
      <Shell>
        <div style={{ padding: "8px 0 16px" }}>
          <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: "#dc2626", fontWeight: 700 }}>
            Application declined
          </p>
          <h1 style={{ margin: "8px 0 12px", fontSize: 22, color: BRAND_INK }}>
            We couldn&rsquo;t approve your account
          </h1>
          <p style={{ margin: "0 0 16px", color: "#4b5563", fontSize: 15, lineHeight: 1.5 }}>
            {status.rejectionReason ||
              "Your application was reviewed and could not be approved at this time."}
          </p>
          <p style={{ margin: "0 0 4px", color: "#6b7280", fontSize: 13 }}>
            If you think this was a mistake, please contact{" "}
            <a href="mailto:info@synergydatalabs.com" style={{ color: BRAND_BLUE }}>
              info@synergydatalabs.com
            </a>
            .
          </p>
        </div>
      </Shell>
    );
  }

  // Under-review screen — both channels verified, waiting on admin.
  if (currentChannel === null) {
    return (
      <Shell>
        <div style={{ padding: "8px 0 16px" }}>
          <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: BRAND_BLUE, fontWeight: 700 }}>
            Application under review
          </p>
          <h1 style={{ margin: "8px 0 12px", fontSize: 22, color: BRAND_INK }}>
            Thanks — you&rsquo;re verified
          </h1>
          <p style={{ margin: "0 0 12px", color: "#4b5563", fontSize: 15, lineHeight: 1.5 }}>
            Both your email and phone are confirmed. Our team is reviewing your
            application and will email you within <strong>1 business day</strong>.
          </p>
          <p style={{ margin: "0", color: "#6b7280", fontSize: 13 }}>
            You can close this tab — you don&rsquo;t need to wait here.
          </p>
        </div>
      </Shell>
    );
  }

  // Active verify step — email OR phone.
  const isEmail = currentChannel === "email";
  // Phase I #4 (2026-09-12): storage is digits-only (matches what
  // Meta/SNS expect), but users think in E.164 with a leading "+".
  // Prepend it for display so what they see mirrors what they typed.
  const rawDest = isEmail ? status.contactEmail : status.contactPhone;
  const dest = isEmail
    ? rawDest
    : rawDest
      ? `+${rawDest}`
      : rawDest;
  const stepNum = isEmail ? 1 : 2;
  const totalSteps = status.contactPhone ? 2 : 1;

  return (
    <Shell>
      <div style={{ padding: "8px 0 16px" }}>
        <p style={{ margin: 0, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", color: BRAND_BLUE, fontWeight: 700 }}>
          Step {stepNum} of {totalSteps}
        </p>
        <h1 style={{ margin: "8px 0 12px", fontSize: 22, color: BRAND_INK }}>
          {isEmail ? "Verify your email" : "Verify your phone"}
        </h1>
        <p style={{ margin: "0 0 20px", color: "#4b5563", fontSize: 15, lineHeight: 1.5 }}>
          We sent a 6-digit code to{" "}
          <strong style={{ color: BRAND_INK }}>{dest || "(unknown)"}</strong>.
          {isEmail
            ? " Check your inbox (and spam folder)."
            : " It'll arrive on WhatsApp — or by SMS if WhatsApp isn't available."}
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="123456"
          style={{
            width: "100%",
            padding: "16px 20px",
            fontSize: 28,
            fontFamily: "'Courier New', monospace",
            letterSpacing: "0.4em",
            textAlign: "center",
            borderRadius: 12,
            border: "1px solid #E1E4EE",
            outline: "none",
            marginBottom: 16,
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && code.length === 6 && !submitting) void submit();
          }}
        />
        <button
          onClick={submit}
          disabled={submitting || code.length !== 6}
          style={{
            width: "100%",
            padding: "14px 20px",
            fontSize: 16,
            fontWeight: 700,
            color: "#ffffff",
            background: BRAND_BLUE,
            border: "none",
            borderRadius: 10,
            cursor: submitting || code.length !== 6 ? "not-allowed" : "pointer",
            opacity: submitting || code.length !== 6 ? 0.55 : 1,
          }}
        >
          {submitting ? "Verifying…" : "Verify"}
        </button>
        <div style={{ marginTop: 16, textAlign: "center" }}>
          <button
            onClick={resend}
            disabled={resending}
            style={{
              background: "none",
              border: "none",
              color: BRAND_BLUE,
              fontSize: 14,
              cursor: resending ? "not-allowed" : "pointer",
              opacity: resending ? 0.6 : 1,
              textDecoration: "underline",
            }}
          >
            {resending ? "Sending…" : "Didn't get it? Send a new code"}
          </button>
        </div>

        {/* Phase I #4 (2026-09-12): change-phone inline editor. Only
            offered on the phone step — email typos are much rarer and
            an email change would risk letting someone bypass verification
            of the original account owner's inbox. Applicant clicks
            "Wrong number?" → input pre-fills with current number → they
            edit + Save → server updates DB, invalidates old code, sends
            a fresh OTP to the new destination. */}
        {!isEmail && (
          <div style={{ marginTop: 12, textAlign: "center" }}>
            {!editingPhone ? (
              <button
                onClick={() => {
                  setPhoneDraft(status.contactPhone ? `+${status.contactPhone}` : "");
                  setEditingPhone(true);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "#6b7280",
                  fontSize: 13,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                Wrong number? Change it
              </button>
            ) : (
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  borderRadius: 10,
                  background: "#ffffff",
                  border: "1px solid #E1E4EE",
                  textAlign: "left",
                }}
              >
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "#6b7280",
                    marginBottom: 6,
                    fontWeight: 600,
                  }}
                >
                  New phone number
                </label>
                <input
                  type="tel"
                  value={phoneDraft}
                  onChange={(e) => setPhoneDraft(e.target.value)}
                  placeholder="+1 (555) 000-0000"
                  autoComplete="tel"
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: 15,
                    borderRadius: 8,
                    border: "1px solid #E1E4EE",
                    outline: "none",
                    marginBottom: 10,
                    boxSizing: "border-box",
                  }}
                />
                <p style={{ margin: "0 0 10px", fontSize: 12, color: "#6b7280" }}>
                  Include the country code (e.g. <code>+1</code> for
                  US/Canada). We&rsquo;ll send a fresh code to this number.
                </p>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      setEditingPhone(false);
                      setPhoneDraft("");
                    }}
                    disabled={submitting}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      fontSize: 14,
                      borderRadius: 8,
                      border: "1px solid #E1E4EE",
                      background: "#ffffff",
                      color: "#374151",
                      cursor: submitting ? "not-allowed" : "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void updatePhone(phoneDraft)}
                    disabled={submitting || !phoneDraft.trim()}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      fontSize: 14,
                      fontWeight: 700,
                      borderRadius: 8,
                      border: "none",
                      background: BRAND_BLUE,
                      color: "#ffffff",
                      cursor:
                        submitting || !phoneDraft.trim()
                          ? "not-allowed"
                          : "pointer",
                      opacity:
                        submitting || !phoneDraft.trim() ? 0.55 : 1,
                    }}
                  >
                    {submitting ? "Saving…" : "Save + send code"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F5F7F8",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "48px 20px" }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <span style={{ fontSize: 28, fontWeight: 800, color: BRAND_NAVY }}>hub</span>
          <span style={{ marginLeft: 8, fontSize: 13, color: "#6b7280" }}>
            by Synergy Data Labs
          </span>
        </div>
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #E5E7EB",
            borderRadius: 16,
            padding: 32,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
