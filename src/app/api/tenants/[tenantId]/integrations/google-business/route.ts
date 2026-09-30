// /api/tenants/[tenantId]/integrations/google-business
//
// GET       → connection status + linked location info
// POST      → action endpoints:
//             { action: "start"   }         → returns the OAuth consent URL
//             { action: "list-locations" }  → returns accounts/locations from GBP
//             { action: "link" , accountResource, locationResource, locationName }
//             { action: "sync"  }           → run push+pull cycle
// DELETE    → disconnect (clears tokens + flags)

import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import {
  buildAuthUrl,
  listAccounts,
  listLocationsForAccount,
  runSync,
} from "@/lib/google-business/client";

const JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

type Params = { tenantId: string };

// ---------- GET ----------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId } = await params;
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) return validation.response;

    const s = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        gbpConnected: true,
        gbpAccountResource: true,
        gbpLocationResource: true,
        gbpLocationName: true,
        gbpConnectedAt: true,
        gbpLastSyncAt: true,
        gbpLastSyncStatus: true,
        gbpLastSyncError: true,
      },
    });

    return NextResponse.json({
      success: true,
      gbp: {
        connected: !!s?.gbpConnected,
        accountResource: s?.gbpAccountResource || null,
        locationResource: s?.gbpLocationResource || null,
        locationName: s?.gbpLocationName || null,
        connectedAt: s?.gbpConnectedAt?.toISOString() ?? null,
        lastSyncAt: s?.gbpLastSyncAt?.toISOString() ?? null,
        lastSyncStatus: s?.gbpLastSyncStatus || null,
        lastSyncError: s?.gbpLastSyncError || null,
      },
    });
  } catch (err: any) {
    console.error("[gbp GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load GBP status" },
      { status: 500 }
    );
  }
}

// ---------- POST ----------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId } = await params;
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) return validation.response;

    const body = await request.json();
    const action = body.action as string;

    if (action === "start") {
      // Sign a short-lived state JWT carrying the tenantId so the callback
      // knows which tenant the auth code belongs to (prevents CSRF too).
      const state = await new SignJWT({ tenantId })
        .setProtectedHeader({ alg: "HS256" })
        .setExpirationTime("10m")
        .sign(JWT_SECRET);
      const url = buildAuthUrl(state);
      return NextResponse.json({ success: true, url });
    }

    if (action === "list-locations") {
      const accounts = await listAccounts(tenantId);
      const allLocations: Array<{
        accountResource: string;
        accountName: string;
        locationResource: string;
        locationTitle: string;
      }> = [];
      for (const acc of accounts) {
        try {
          const locs = await listLocationsForAccount(tenantId, acc.name);
          for (const l of locs) {
            allLocations.push({
              accountResource: acc.name,
              accountName: acc.accountName,
              locationResource: l.name,
              locationTitle: l.title,
            });
          }
        } catch (err) {
          // Skip accounts we can't enumerate (rare permission edge cases)
          console.warn("[gbp list-locations] skipping account", acc.name, err);
        }
      }
      return NextResponse.json({ success: true, locations: allLocations });
    }

    if (action === "link") {
      const { accountResource, locationResource, locationName } = body;
      if (!accountResource || !locationResource) {
        return NextResponse.json(
          { error: "accountResource and locationResource required" },
          { status: 400 }
        );
      }
      await prisma.tenantSettings.update({
        where: { tenantId },
        data: {
          gbpAccountResource: accountResource,
          gbpLocationResource: locationResource,
          gbpLocationName: locationName || null,
        },
      });
      return NextResponse.json({ success: true });
    }

    if (action === "sync") {
      const result = await runSync(tenantId);
      return NextResponse.json({ success: result.ok, steps: result.steps });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error("[gbp POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Action failed" },
      { status: 500 }
    );
  }
}

// ---------- DELETE ----------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { tenantId } = await params;
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) return validation.response;

    await prisma.tenantSettings.update({
      where: { tenantId },
      data: {
        gbpConnected: false,
        gbpAccountResource: null,
        gbpLocationResource: null,
        gbpLocationName: null,
        gbpAccessTokenEnc: null,
        gbpRefreshTokenEnc: null,
        gbpTokenExpiresAt: null,
        gbpConnectedAt: null,
      },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[gbp DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Disconnect failed" },
      { status: 500 }
    );
  }
}
