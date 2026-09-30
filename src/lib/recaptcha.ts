// reCAPTCHA verification — Phase E R5.
//
// One helper for both v2 (checkbox / invisible) and v3 (score-based).
// Google's /siteverify endpoint accepts either; v3 additionally returns
// a `score` (0.0..1.0) and `action` — v2 returns just `success`.
//
// The helper returns a normalized result so route handlers don't have
// to branch. Score threshold is configurable per-call — booking flows
// use 0.5 (recommended default for public forms).
//
// FAILS OPEN when RECAPTCHA_SECRET_KEY is not set — dev / test runs
// without configuration don't hard-block. In production, always set
// the env var; a missing key logs a warning so it's visible.

export interface RecaptchaResult {
  ok: boolean;
  score?: number;            // v3 only
  action?: string;           // v3 only
  errorCodes?: string[];
  reason?: string;           // human-readable for logs
}

interface GoogleVerifyResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  score?: number;
  action?: string;
  "error-codes"?: string[];
}

export interface VerifyOptions {
  token: string;
  /** Client IP for extra fraud signals — optional per Google's API. */
  ip?: string;
  /** v3 score threshold. Default 0.5 (Google's suggested public-form baseline). */
  minScore?: number;
  /** v3 expected action name — mismatched action = suspicious. Optional. */
  expectedAction?: string;
}

const VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

export async function verifyRecaptcha(opts: VerifyOptions): Promise<RecaptchaResult> {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    // Dev fallback — don't hard-block calls when the secret isn't
    // configured. Warn loudly so ops sees it in the logs.
    console.warn(
      "[recaptcha] RECAPTCHA_SECRET_KEY not set — accepting all tokens. " +
        "Set it in production."
    );
    return { ok: true, reason: "secret-not-configured" };
  }
  if (!opts.token || opts.token.trim().length === 0) {
    return { ok: false, reason: "empty-token" };
  }

  const form = new URLSearchParams();
  form.set("secret", secret);
  form.set("response", opts.token);
  if (opts.ip) form.set("remoteip", opts.ip);

  let raw: GoogleVerifyResponse;
  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      // Google's endpoint responds in <500ms typically. Cap to keep our
      // request quick — booking submit shouldn't hang on this.
      signal: AbortSignal.timeout(5000),
    });
    raw = (await res.json()) as GoogleVerifyResponse;
  } catch (err: any) {
    console.error("[recaptcha] verify fetch failed:", err?.message || err);
    // Fail-CLOSED on network error — better to make the user retry than
    // let a bot through because Google was slow.
    return { ok: false, reason: "verify-network-error" };
  }

  if (!raw.success) {
    return {
      ok: false,
      errorCodes: raw["error-codes"],
      reason: `verify-failed: ${(raw["error-codes"] || []).join(",") || "no reason"}`,
    };
  }

  // v3 path — score + action checks
  if (typeof raw.score === "number") {
    const threshold = opts.minScore ?? 0.5;
    if (raw.score < threshold) {
      return {
        ok: false,
        score: raw.score,
        action: raw.action,
        reason: `low-score: ${raw.score.toFixed(2)} < ${threshold}`,
      };
    }
    if (opts.expectedAction && raw.action && raw.action !== opts.expectedAction) {
      return {
        ok: false,
        score: raw.score,
        action: raw.action,
        reason: `action-mismatch: got ${raw.action}, expected ${opts.expectedAction}`,
      };
    }
  }

  return { ok: true, score: raw.score, action: raw.action };
}

/** Convenience: extract the caller's IP from a NextRequest for the ip field. */
export function ipFromRequest(request: Request): string | undefined {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  return real || undefined;
}
