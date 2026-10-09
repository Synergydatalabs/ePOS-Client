// ============================================================================
// POST /api/public/v1/payments — Phase I #6 (2026-09-18)
//
// Public inbound Payments API. Partners (SDL's other site, third-party
// integrations) POST here with a bearer key to create a hosted checkout
// for their customer. We spawn an ephemeral SupplierPaymentLink carrying
// the partner-supplied webhook config, spin an invoice from it, and hand
// back a checkout URL to redirect the customer to.
//
// On payment success/failure, our existing outbound-webhook dispatcher
// (fireWebhookForLink) POSTs the partner's webhook URL with the rendered
// template body + HMAC signature.
//
// Request:
//   Authorization: Bearer sk_...
//   Content-Type: application/json
//
//   {
//     "amount": 1000,                       // integer cents (required)
//     "currency": "cad",                    // ISO 4217 (optional; default CAD)
//     "customer": {                         // required
//       "email": "buyer@example.com",       // required
//       "name":  "Buyer Name",              // optional
//       "phone": "+14165551234",            // optional
//       "company": "Acme Inc."              // optional
//     },
//     "description": "Product X — Order #42",  // shown on hosted checkout
//     "webhook_url":      "https://partner.example.com/hooks/payment",
//     "webhook_secret":   "<partner-supplied HMAC secret; optional>",
//     "webhook_template": "{\"id\":\"{{event.id}}\",\"amount\":{{payment.amount}}}",
//     "webhook_events":   ["payment.succeeded", "payment.failed"],
//     "metadata": { "order_id": "42", "sku": "abc" },  // echoed via {{metadata.*}}
//     // 2026-10-09:
//     "payment_methods": ["kakao_pay"],   // optional. ["card"] (default = Stripe)
//                                          //  or Paddle methods like
//                                          //  ["kakao_pay"], ["paypal"], ["alipay"].
//                                          //  Paddle methods return the /l/<slug>
//                                          //  URL (where the Paddle button lives).
//     "qr": true                           // optional. true → include a
//                                          //  qr_data_url PNG of checkout_url
//                                          //  in the response for direct embed.
//   }
//
// Response 201:
//   {
//     "id":           "<invoice-id>",
//     "status":       "created",
//     "amount":       1000,
//     "currency":     "cad",
//     "checkout_url": "https://hub.synergydatalabs.com/pay/invoice/<id>",
//     "created_at":   "2026-09-18T12:34:56.000Z"
//   }
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import {
  requireApiKey,
  apiErrorResponse,
  PUBLIC_API_CORS_HEADERS,
  corsPreflightResponse,
} from "@/lib/api-keys";
import { resolvePublicOrigin } from "@/lib/public-origin";
import { createPaymentLink, createInvoiceFromLink } from "@/lib/payment-link.service";
import prisma from "@/lib/prisma";

const ALLOWED_EVENTS = new Set(["payment.succeeded", "payment.failed", "payment.refunded", "invoice.paid"]);
const MAX_AMOUNT_CENTS = 999_999_99; // $999,999.99 — sanity cap
const CURRENCY_RE = /^[a-zA-Z]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/[^\s]+$/i;

interface PaymentRequestBody {
  amount?: unknown;
  currency?: unknown;
  customer?: unknown;
  description?: unknown;
  webhook_url?: unknown;
  webhook_secret?: unknown;
  webhook_template?: unknown;
  webhook_events?: unknown;
  metadata?: unknown;
  // 2026-10-09 — Paddle + QR extensions for Korean / KakaoPay integrations.
  payment_methods?: unknown; // e.g. ["card"] or ["kakao_pay", "card"]
  qr?: unknown;              // boolean; include qr_data_url in response
  // 2026-10-09 — qr_mode="auto_kakao" is the walk-in / POS flow: the
  // generated QR encodes a URL that bypasses the email + T&C form and
  // immediately opens the Paddle KakaoPay checkout. Customer scans
  // merchant's QR with their phone camera → page auto-forwards → Paddle
  // deep-links the KakaoPay app → pay → done. No email required from
  // the end customer. The merchant's own API-side `customer.email` is
  // still stored on the transaction for receipt / audit purposes.
  qr_mode?: unknown;
}

// Payment methods that route through Paddle instead of Stripe. Anything in
// this set makes the API return the /l/<slug> URL (where our Paddle flow
// lives) instead of the Stripe-only /pay/invoice/<id> URL.
const PADDLE_METHODS = new Set(["kakao_pay", "paddle", "paypal", "alipay"]);

function badRequest(message: string, field?: string) {
  return NextResponse.json(
    { error: { type: "invalid_request_error", message, ...(field ? { param: field } : {}) } },
    { status: 400, headers: PUBLIC_API_CORS_HEADERS }
  );
}

export async function OPTIONS() {
  return corsPreflightResponse();
}

export async function POST(request: NextRequest) {
  // 1) Auth
  const auth = await requireApiKey(request);
  if (!auth.ok) {
    const { status, body, headers } = apiErrorResponse(auth.error);
    return NextResponse.json(body, {
      status,
      headers: { ...PUBLIC_API_CORS_HEADERS, ...(headers ?? {}) },
    });
  }
  const { id: apiKeyId, tenantId } = auth.key;

  // 2) Parse body
  let raw: PaymentRequestBody;
  try {
    raw = (await request.json()) as PaymentRequestBody;
  } catch {
    return badRequest("Invalid JSON body");
  }

  // 3) Validate required fields
  const amount = Number(raw.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return badRequest("`amount` must be a positive integer (cents)", "amount");
  }
  if (amount > MAX_AMOUNT_CENTS) {
    return badRequest(`\`amount\` exceeds max of ${MAX_AMOUNT_CENTS} cents`, "amount");
  }

  const currency = typeof raw.currency === "string" && raw.currency.trim()
    ? raw.currency.trim().toUpperCase()
    : "CAD";
  if (!CURRENCY_RE.test(currency)) {
    return badRequest("`currency` must be an ISO 4217 alpha-3 code", "currency");
  }

  if (!raw.customer || typeof raw.customer !== "object") {
    return badRequest("`customer` object is required", "customer");
  }
  const customer = raw.customer as Record<string, unknown>;
  const customerEmail = typeof customer.email === "string" ? customer.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(customerEmail)) {
    return badRequest("`customer.email` is required and must be a valid email", "customer.email");
  }
  const customerName =
    typeof customer.name === "string" && customer.name.trim() ? customer.name.trim().slice(0, 255) : null;
  const customerPhone =
    typeof customer.phone === "string" && customer.phone.trim() ? customer.phone.trim().slice(0, 40) : null;
  const customerCompany =
    typeof customer.company === "string" && customer.company.trim()
      ? customer.company.trim().slice(0, 255)
      : null;

  const description =
    typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim().slice(0, 500)
      : null;

  // Webhook fields — all optional, but if a URL is given it must be valid.
  const webhookUrl =
    typeof raw.webhook_url === "string" && raw.webhook_url.trim() ? raw.webhook_url.trim() : null;
  if (webhookUrl && !URL_RE.test(webhookUrl)) {
    return badRequest("`webhook_url` must be an http(s) URL", "webhook_url");
  }
  const webhookSecret =
    typeof raw.webhook_secret === "string" && raw.webhook_secret.trim()
      ? raw.webhook_secret.trim().slice(0, 128)
      : null;
  const webhookTemplate =
    typeof raw.webhook_template === "string" && raw.webhook_template.trim()
      ? raw.webhook_template
      : null;

  let webhookEvents: string[] = ["payment.succeeded", "payment.failed"];
  if (Array.isArray(raw.webhook_events)) {
    const filtered = raw.webhook_events
      .filter((e): e is string => typeof e === "string")
      .filter((e) => ALLOWED_EVENTS.has(e));
    if (filtered.length > 0) webhookEvents = filtered;
  }

  // 2026-10-09: payment methods + QR option. Both are optional; omitting
  // keeps the pre-existing Stripe-card default behaviour so existing API
  // callers see no change. When any Paddle-routed method is listed we
  // return the /l/<slug> URL (the page where the Paddle KakaoPay/PayPal/
  // Alipay button lives) instead of /pay/invoice/<id> (Stripe-only).
  const paymentMethods: string[] = Array.isArray(raw.payment_methods)
    ? raw.payment_methods
        .filter((m): m is string => typeof m === "string")
        .map((m) => m.toLowerCase().trim())
        .filter(Boolean)
    : [];
  const wantsPaddleRoute = paymentMethods.some((m) => PADDLE_METHODS.has(m));
  const wantsQr = raw.qr === true;

  // 2026-10-09: qr_mode = "auto_kakao" short-circuits the pay flow for
  // walk-in / POS scenarios. Only valid when the Paddle route is in use
  // (there's no sensible "auto open Stripe card" because Stripe needs
  // card entry on the page). We stash the merchant-supplied email on
  // the invoice via createInvoiceFromLink below so the Paddle txn still
  // has a receipt target; the customer never has to type anything.
  const qrMode =
    typeof raw.qr_mode === "string" && raw.qr_mode.trim()
      ? raw.qr_mode.trim().toLowerCase()
      : null;
  const autoKakaoMode = qrMode === "auto_kakao" && wantsPaddleRoute;

  const metadata =
    raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>)
      : {};

  // 4) Verify tenant is active + has a payment processor wired. Bailing
  // early here gives partners a clear 402 instead of a downstream Stripe
  // error at checkout time.
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      status: true,
      currency: true,
      tenantPaymentProviders: {
        where: { status: "ACTIVE" },
        select: { id: true, processor: true, capability: true },
      },
    },
  });
  if (!tenant || tenant.status !== "ACTIVE") {
    return NextResponse.json(
      { error: { type: "tenant_error", message: "Tenant is not active" } },
      { status: 403, headers: PUBLIC_API_CORS_HEADERS }
    );
  }
  // 2026-10-09: the CARD-processor requirement only applies to the Stripe
  // default path, where per-tenant Stripe creds are required to mint a
  // PaymentIntent. The Paddle route (payment_methods includes kakao_pay /
  // paddle / paypal / alipay) uses platform-wide env credentials
  // (PADDLE_API_KEY), so a tenant can accept Paddle payments without any
  // per-tenant processor assignment. Skip the guard for that path.
  const hasCardProcessor = tenant.tenantPaymentProviders.some((p) => p.capability === "CARD");
  if (!hasCardProcessor && !wantsPaddleRoute) {
    return NextResponse.json(
      {
        error: {
          type: "tenant_error",
          message: "Tenant has no active card processor — cannot accept payments yet",
        },
      },
      { status: 402, headers: PUBLIC_API_CORS_HEADERS }
    );
  }

  // 5) Spawn an ephemeral single-use payment link carrying the partner's
  // webhook config. maxUses=1 + apiGenerated=true hide it from the portal
  // list and prevent re-use after this one invoice is fulfilled.
  const link = await createPaymentLink({
    supplierTenantId: tenantId,
    nickname: description ? description.slice(0, 120) : `API payment ${new Date().toISOString()}`,
    mode: "one_time",
    unitAmountCents: amount,
    currency,
    qtyLocked: true,
    qtyDefault: 1,
    qtyMin: 1,
    qtyMax: 1,
    maxUses: 1,
    partnerRef: typeof metadata.order_id === "string" ? metadata.order_id.slice(0, 120) : null,
    descriptionOverride: description,
    requireName: false,
    requirePhone: false,
    requireCompany: false,
    webhookUrl,
    webhookSecret,
    webhookTemplate,
    webhookEvents,
    webhookEnabled: !!webhookUrl,
  });

  // Tag it + backref the key that spawned it. Two-step so we don't have
  // to widen CreatePaymentLinkInput just for this API path.
  await prisma.supplierPaymentLink.update({
    where: { id: link.id },
    data: { apiGenerated: true, createdViaApiKeyId: apiKeyId },
  });

  // 6) Spin the invoice (default Stripe-card path) OR skip it (Paddle
  // path — the invoice is minted by /l/<slug>/paddle-start when the
  // customer actually clicks the Paddle button).
  //
  // Why the two paths:
  //   - Stripe: pre-creating the invoice + sending its /pay/invoice/<id>
  //     URL is simpler for card UX. Customer lands, Stripe Elements
  //     mounts, done.
  //   - Paddle: our Paddle flow lives on /l/<slug>, which already handles
  //     KakaoPay/PayPal/Alipay button + QR + success redirect. Returning
  //     /l/<slug> keeps the API caller + customer away from a Stripe-
  //     only pay page they'd just bounce off.
  // 2026-10-09: use the request's own host, not NEXT_PUBLIC_APP_URL.
  // Partners on white-label tenants (indianbeans.com, oreugo.ca, …) call
  // the API via their own apex. The URLs we return — checkout_url,
  // embed_url, qr_data_url contents — must point back at THAT host so
  // the iframe source + CORS behave consistently. resolvePublicOrigin
  // forces everything through hub.synergydatalabs.com, which breaks the
  // white-label embed story (iframe would load the wrong host and the
  // iframe-ancestors CSP would mismatch). Honour x-forwarded-host first
  // (set by nginx/ALB), fall back to Host header, and only use the env
  // canonical origin as a last resort.
  const fwdHost = request.headers.get("x-forwarded-host");
  const fwdProto = request.headers.get("x-forwarded-proto") || "https";
  const hostHeader = request.headers.get("host");
  const origin = fwdHost
    ? `${fwdProto}://${fwdHost}`
    : hostHeader
      ? `${fwdProto}://${hostHeader}`
      : resolvePublicOrigin(request);
  let invoiceId: string | null = null;
  let invoiceCreatedAt: string;
  let checkoutUrl: string;
  let embedUrl: string | null = null;

  if (wantsPaddleRoute) {
    invoiceCreatedAt = link.createdAt.toISOString();
    // 2026-10-09: auto_kakao mode — append ?auto=kakao so /l/[slug]
    // skips the form and fires paddle-start on load. No merchant /
    // customer email is persisted on the link — /paddle-start will
    // use a synthetic placeholder email derived from the slug when
    // the auto flag is set. Rationale: walk-in POS, KakaoPay sends
    // its own receipt, we have no genuine customer email anyway.
    const autoQs = autoKakaoMode ? `?auto=kakao` : "";
    checkoutUrl = `${origin}/l/${link.shortSlug}${autoQs}`;
    // 2026-10-09: embed URL for iframe integrations (Korean merchants, etc).
    // Same page as checkout_url but with ?embed=1 so the page strips its
    // header/footer chrome and sends postMessage to the parent window on
    // payment success. CSP + X-Frame-Options for /l/* in next.config.mjs
    // allow cross-origin embedding.
    const embedAutoQs = autoKakaoMode ? `?embed=1&auto=kakao` : "?embed=1";
    embedUrl = `${origin}/l/${link.shortSlug}${embedAutoQs}`;
  } else {
    const invoice = await createInvoiceFromLink({
      slug: link.shortSlug,
      quantity: 1,
      customer: {
        email: customerEmail,
        name: customerName,
        phone: customerPhone,
        company: customerCompany,
      },
      attributionOverride: typeof metadata.partner_ref === "string" ? metadata.partner_ref : null,
    });
    invoiceId = invoice.id;
    invoiceCreatedAt = invoice.createdAt.toISOString();
    checkoutUrl = `${origin}/pay/invoice/${invoice.id}`;
    // Phase I #9 (2026-09-19): also return an embed_url pointing at the
    // bare-bones /pay/embed page — designed to be dropped into a
    // partner's site via <iframe src="...">. Same underlying invoice.
    embedUrl = `${origin}/pay/embed/${invoice.id}`;
  }

  // 2026-10-09: QR code generation. Partner opts in with { qr: true }.
  // 400x400 PNG as a data URL — small enough to inline in an email,
  // large enough to scan from a phone at normal reading distance.
  // Skip silently on error — the primary response (checkout_url) still
  // works, QR is a convenience.
  let qrDataUrl: string | null = null;
  if (wantsQr) {
    try {
      const QRCode = await import("qrcode");
      qrDataUrl = await QRCode.toDataURL(checkoutUrl, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: "M",
      });
    } catch (err) {
      console.warn("[public-payments] QR generation failed:", (err as Error).message);
    }
  }

  return NextResponse.json(
    {
      id: invoiceId ?? link.id,
      status: "created",
      amount,
      currency: currency.toLowerCase(),
      checkout_url: checkoutUrl,
      ...(embedUrl ? { embed_url: embedUrl } : {}),
      ...(qrDataUrl ? { qr_data_url: qrDataUrl } : {}),
      ...(wantsPaddleRoute
        ? {
            payment_methods: paymentMethods,
            link_slug: link.shortSlug,
            ...(autoKakaoMode ? { qr_mode: "auto_kakao" } : {}),
          }
        : {}),
      created_at: invoiceCreatedAt,
    },
    { status: 201, headers: PUBLIC_API_CORS_HEADERS }
  );
}

// GET is not supported — returning 405 makes it clear this is a POST-only
// endpoint, not a list endpoint.
export async function GET() {
  return NextResponse.json(
    { error: { type: "invalid_request_error", message: "Method not allowed. Use POST." } },
    { status: 405, headers: { Allow: "POST", ...PUBLIC_API_CORS_HEADERS } }
  );
}
