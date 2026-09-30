// Phase I #5 v2 (2026-09-14): outbound webhook delivery worker.
//
// One `deliverWebhook()` call = one payment link × one event. Signs
// the already-rendered body, POSTs with a 10s timeout, retries on
// network error / 5xx up to 3 attempts with backoff, records every
// attempt in `webhook_deliveries` (linked to the payment link) for
// the partner-facing log.
//
// Non-2xx from the partner counts as a delivery failure. 4xx is NOT
// retried (partner refusing us intentionally). 5xx and network errors
// ARE retried.

import prisma from "@/lib/prisma";
import { signWebhook } from "./sign";

const RETRY_BACKOFF_MS = [0, 500, 2000];
const REQUEST_TIMEOUT_MS = 10_000;

export interface DeliverArgs {
  paymentLinkId: string;
  tenantId: string;
  url: string;
  // Phase I #5 v3 (2026-09-14): partner-supplied HMAC secret. When
  // set, we add X-Payment-Signature header (Stripe pattern) so
  // security-conscious partners can verify. When empty/null, we skip
  // signing entirely — the partner presumably relies on a URL token
  // (TradingView pattern) or trusts the URL alone.
  secret: string | null;
  contentType: string;
  eventType: string;
  eventId: string;
  body: string;         // already rendered from the template
}

export interface DeliverResult {
  succeeded: boolean;
  attempts: number;
  finalStatus?: number;
  errorMessage?: string;
}

export async function deliverWebhook(args: DeliverArgs): Promise<DeliverResult> {
  let attempt = 0;
  let lastStatus: number | undefined;
  let lastError: string | undefined;

  for (const backoffMs of RETRY_BACKOFF_MS) {
    attempt += 1;
    if (backoffMs > 0) await sleep(backoffMs);

    const started = Date.now();
    const attemptResult = await attemptDelivery(args);
    const durationMs = Date.now() - started;

    await logAttempt({
      paymentLinkId: args.paymentLinkId,
      tenantId: args.tenantId,
      url: args.url,
      eventType: args.eventType,
      eventId: args.eventId,
      attempt,
      requestBody: args.body,
      responseStatus: attemptResult.status ?? null,
      responseBody: attemptResult.responseBody ?? null,
      durationMs,
      succeeded: attemptResult.ok,
      errorMessage: attemptResult.error ?? null,
    });

    if (attemptResult.ok) {
      return { succeeded: true, attempts: attempt, finalStatus: attemptResult.status };
    }

    lastStatus = attemptResult.status;
    lastError = attemptResult.error;

    // 4xx = partner is intentionally refusing — retrying won't help.
    if (attemptResult.status && attemptResult.status >= 400 && attemptResult.status < 500) {
      break;
    }
  }

  return {
    succeeded: false,
    attempts: attempt,
    finalStatus: lastStatus,
    errorMessage: lastError,
  };
}

interface AttemptResult {
  ok: boolean;
  status?: number;
  responseBody?: string;
  error?: string;
}

async function attemptDelivery(args: DeliverArgs): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Phase I #5 v3 (2026-09-14): sign only when partner provided a
  // secret. Empty secret → no signature header. URL-token / no-auth
  // integrations still work; HMAC verification stays available for
  // partners who provided a secret.
  const headers: Record<string, string> = {
    "Content-Type": args.contentType,
    "X-Payment-Event": args.eventType,
    "X-Payment-Event-Id": args.eventId,
    "User-Agent": "SDL-Payments-Webhooks/1.0",
  };
  if (args.secret && args.secret.trim().length > 0) {
    const sig = signWebhook(args.secret, args.body);
    headers["X-Payment-Signature"] = sig.header;
  }

  try {
    const res = await fetch(args.url, {
      method: "POST",
      headers,
      body: args.body,
      signal: controller.signal,
    });
    const responseText = await res.text().catch(() => "");
    const truncated =
      responseText.length > 1024 ? responseText.slice(0, 1021) + "..." : responseText;
    return { ok: res.ok, status: res.status, responseBody: truncated };
  } catch (err: any) {
    const message =
      err?.name === "AbortError"
        ? `Timeout after ${REQUEST_TIMEOUT_MS}ms`
        : err?.message || String(err);
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

interface LogAttemptArgs {
  paymentLinkId: string;
  tenantId: string;
  url: string;
  eventType: string;
  eventId: string;
  attempt: number;
  requestBody: string;
  responseStatus: number | null;
  responseBody: string | null;
  durationMs: number;
  succeeded: boolean;
  errorMessage: string | null;
}

async function logAttempt(args: LogAttemptArgs): Promise<void> {
  try {
    await prisma.webhookDelivery.create({
      data: {
        paymentLinkId: args.paymentLinkId,
        tenantId: args.tenantId,
        url: args.url,
        eventType: args.eventType,
        eventId: args.eventId,
        attempt: args.attempt,
        requestBody: args.requestBody,
        responseStatus: args.responseStatus,
        responseBody: args.responseBody,
        durationMs: args.durationMs,
        succeeded: args.succeeded,
        errorMessage: args.errorMessage
          ? args.errorMessage.slice(0, 500)
          : null,
      },
    });
  } catch (err) {
    console.error(
      `[webhook] failed to log delivery for link ${args.paymentLinkId}:`,
      err
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
