// Partner-billing lookup.
//
// The "Contact Billing" button on Settings → Billing routes merchants
// to their platform's billing team — which is different per partner
// deployment (oreugo.ca merchants email Oreugo; raw itap.zashx.com
// merchants email Zashx support). The merchant themselves has no idea
// which partner runs the platform they signed up on, so this is NOT
// configurable per tenant. It's a deployment-level lookup keyed on the
// hostname the merchant is currently visiting.
//
// To onboard a new partner: add one line to PARTNER_BILLING_MAP below,
// deploy. No DB migration, no per-tenant setup.

const PARTNER_BILLING_MAP: Record<string, string> = {
  // Oreugo — partner deployment
  "oreugo.ca": "info@oreugo.ca",
  "www.oreugo.ca": "info@oreugo.ca",

  // Zashx-branded (canonical) — merchants here talk to Zashx support
  "itap.zashx.com": "support@zashx.com",
  "www.itap.zashx.com": "support@zashx.com",

  // Local dev — same fallback so developers don't get a broken mailto
  localhost: "support@zashx.com",
};

const DEFAULT_BILLING_EMAIL = "support@zashx.com";

/**
 * Resolve the "Contact Billing" mailto address for a given hostname.
 * Strips port (localhost:3000), lower-cases, falls back to Zashx
 * support if the host isn't recognised.
 */
export function billingEmailForHost(hostname: string | undefined | null): string {
  if (!hostname) return DEFAULT_BILLING_EMAIL;
  const host = hostname.split(":")[0].toLowerCase();
  return PARTNER_BILLING_MAP[host] || DEFAULT_BILLING_EMAIL;
}
