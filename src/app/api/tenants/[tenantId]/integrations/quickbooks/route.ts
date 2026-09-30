// GET  /api/tenants/[tenantId]/integrations/quickbooks?region=US|CA
//   Returns the current connection status + mapping. Region defaults
//   to US. Also lists both regions so the admin UI can show whether
//   the server is configured for CA at all.
//
// PATCH /api/tenants/[tenantId]/integrations/quickbooks
//   Body: { region, salesAccountRef?, taxLiabilityRef?, ... }
//   Update the Chart of Accounts mapping. Doesn't touch tokens.
//
// DELETE /api/tenants/[tenantId]/integrations/quickbooks?region=US|CA
//   Disconnect. Wipes tokens locally — merchant should also revoke on
//   the QBO side to be fully clean.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { creds, listAccounts, regionToProvider, type Region } from "@/lib/quickbooks";

type Params = { params: Promise<{ tenantId: string }> };

const MAPPING_FIELDS = [
  "salesAccountRef",
  "taxLiabilityRef",
  "tipsLiabilityRef",
  "discountsAccountRef",
  "refundsAccountRef",
  "cashAccountRef",
  "cardAccountRef",
] as const;

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const region = ((new URL(request.url).searchParams.get("region") || "US") as Region);

    const connections = await prisma.integrationConnection.findMany({
      where: {
        tenantId,
        provider: { in: ["QUICKBOOKS_US", "QUICKBOOKS_CA"] },
      },
      select: {
        id: true,
        provider: true,
        status: true,
        realmId: true,
        companyName: true,
        lastSyncAt: true,
        lastError: true,
        lastErrorAt: true,
        connectedAt: true,
        salesAccountRef: true,
        taxLiabilityRef: true,
        tipsLiabilityRef: true,
        discountsAccountRef: true,
        refundsAccountRef: true,
        cashAccountRef: true,
        cardAccountRef: true,
      },
    });

    // Include server-configured flag per region so admin UI can show the
    // "not configured" message with an env-var pointer.
    const serverConfigured = {
      US: !!creds("US"),
      CA: !!creds("CA"),
    };

    // If a connection exists + status CONNECTED, try to fetch account list
    // for the mapping dropdowns. Fail-soft — token expired or QBO down
    // shouldn't break the page load.
    let accounts: Awaited<ReturnType<typeof listAccounts>> = [];
    const activeConn = connections.find(
      (c) => c.provider === regionToProvider(region) && c.status === "CONNECTED"
    );
    if (activeConn) {
      try {
        accounts = await listAccounts(activeConn.id);
      } catch (err: any) {
        console.warn("[qbo GET] listAccounts failed:", err?.message);
      }
    }

    return NextResponse.json({
      success: true,
      connections,
      serverConfigured,
      accounts,
    });
  } catch (error: any) {
    console.error("[qbo GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const region = (body.region || "US") as Region;
    if (region !== "US" && region !== "CA") {
      return NextResponse.json(
        { error: "region must be US or CA" },
        { status: 400 }
      );
    }

    // Whitelist just the mapping fields so callers can't touch tokens
    const updates: any = {};
    for (const f of MAPPING_FIELDS) {
      if (f in body) updates[f] = body[f] || null;
    }

    const connection = await prisma.integrationConnection.upsert({
      where: {
        tenantId_provider: { tenantId, provider: regionToProvider(region) },
      },
      create: {
        tenantId,
        provider: regionToProvider(region),
        ...updates,
      },
      update: updates,
    });

    return NextResponse.json({ success: true, connection });
  } catch (error: any) {
    console.error("[qbo PATCH] error:", error);
    return NextResponse.json(
      { error: error?.message || "Update failed" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const region = ((new URL(request.url).searchParams.get("region") || "US") as Region);
    if (region !== "US" && region !== "CA") {
      return NextResponse.json(
        { error: "region must be US or CA" },
        { status: 400 }
      );
    }

    await prisma.integrationConnection.updateMany({
      where: { tenantId, provider: regionToProvider(region) },
      data: {
        status: "DISCONNECTED",
        accessTokenEnc: null,
        refreshTokenEnc: null,
        accessTokenExpires: null,
        realmId: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[qbo DELETE] error:", error);
    return NextResponse.json(
      { error: error?.message || "Disconnect failed" },
      { status: 500 }
    );
  }
}
