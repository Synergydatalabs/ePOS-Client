// ============================================================================
// Payment endpoint registry — server-side dispatch table.
//
// Maps each processor to the internal route that handles its charge
// operation. The dispatcher at /api/tenants/[tenantId]/payments/charge
// reads this registry and forwards the request to the right route, so
// the POS only ever needs to know about ONE URL.
//
// To add a new provider (e.g. Stripe):
//   1. Create src/app/api/tenants/[tenantId]/payments/stripe/charge/route.ts
//   2. Add a "STRIPE" entry below with its path
//   3. Add STRIPE to the Prisma PaymentProcessor enum + provider-router types
//   4. Add src/lib/providers/stripe/admin.ts + register on the admin side
//
// Zero existing provider code needs to be touched.
// ============================================================================

import type { Processor } from "./provider-router";

/**
 * Function returning the charge-endpoint path for a given tenant. Paths
 * are relative to the same origin, so the dispatcher can call them via
 * `new URL(path, request.url)`. Providers without an entry here return
 * 501 from the dispatcher — clearer than a silent 404.
 */
export const CHARGE_ENDPOINT: Partial<Record<Processor, (tenantId: string) => string>> = {
  GP: (tenantId) => `/api/tenants/${tenantId}/payments/uci/bill`,
  MONERIS: (tenantId) => `/api/tenants/${tenantId}/payments/moneris/charge`,
  // STRIPE: (tenantId) => `/api/tenants/${tenantId}/payments/stripe/charge`, // add when the route exists
};
