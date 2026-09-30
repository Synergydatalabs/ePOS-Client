// GET /api/mobile/tenant-config
//
// Returns the tenant's active card provider + list of terminals so the
// mobile CheckoutHubScreen can render the right tender buttons per tenant.
//
// Response shape:
//   {
//     location: { id, name },
//     cardProvider: { processor: "GP" | "MONERIS" | "STRIPE", isActive } | null,
//     terminals: [{ id, name, status, isDefault }],
//     availableTenders: {
//       cash: true,                    // always
//       mcoQr: boolean,                // Moneris hosted checkout (QR) available
//       terminal: boolean              // Any ONLINE terminal at this location
//     }
//   }
//
// Cached for 60s per-process on the getActiveProvider side; we don't add
// another layer here because tenant config changes are rare and mobile
// only fetches once per login anyway.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";
import { getActiveProvider } from "@/lib/payment-providers/provider-router";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const [location, cardProvider, terminals] = await Promise.all([
    prisma.location.findUnique({
      where: { id: ctx.ctx.locationId },
      select: { id: true, name: true },
    }),
    getActiveProvider({ tenantId: ctx.ctx.tenantId, capability: "CARD" }),
    prisma.terminal.findMany({
      where: { locationId: ctx.ctx.locationId },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        isDefault: true,
        provider: true,
        uciLane: true,
      },
    }),
  ]);

  // Only surface terminals that are actually configured to charge:
  //  - GP UCI: needs uciLane
  //  - Moneris: provider="MONERIS" — the specific device is set in the
  //    tenant's provider credentials (terminal_id there), not the lane
  const chargeableTerminals = terminals.filter(
    (t) => (t.provider === "UCI" && t.uciLane) || t.provider === "MONERIS"
  );

  const onlineCount = chargeableTerminals.filter((t) => t.status === "ONLINE").length;

  // For the terminal button, require BOTH: an active provider AND at least
  // one online chargeable terminal that matches the provider.
  const gpOnline = chargeableTerminals.some(
    (t) => t.provider === "UCI" && t.status === "ONLINE"
  );
  const monerisOnline = chargeableTerminals.some(
    (t) => t.provider === "MONERIS" && t.status === "ONLINE"
  );
  const terminalReady =
    (cardProvider?.processor === "GP" && gpOnline) ||
    (cardProvider?.processor === "MONERIS" && monerisOnline);

  return NextResponse.json({
    location: location
      ? { id: location.id, name: location.name }
      : null,
    cardProvider: cardProvider
      ? { processor: cardProvider.processor, isActive: true }
      : null,
    terminals: chargeableTerminals.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      isDefault: t.isDefault,
    })),
    availableTenders: {
      cash: true,
      // MCO QR: tenant on Moneris AND platform MCO env vars set.
      mcoQr:
        cardProvider?.processor === "MONERIS" &&
        Boolean(
          process.env.MONERIS_MCO_STORE_ID &&
            process.env.MONERIS_MCO_API_TOKEN &&
            process.env.MONERIS_MCO_CHECKOUT_ID
        ),
      // Terminal: tenant provider matches an ONLINE terminal for that
      // processor at this location. GP → UCI terminal; Moneris → MONERIS
      // terminal (A4.5 shipped 2026-08-18).
      terminal: terminalReady,
    },
  });
}
