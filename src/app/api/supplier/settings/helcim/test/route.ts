// =============================================================================
// POST /api/supplier/settings/helcim/test
// Test a Helcim API token (or the currently-stored one) by hitting a
// read-only identity endpoint. Returns the account name on success.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import { kybDecryptJson } from "@/lib/kyb-crypto";
import { testHelcimApiToken } from "@/lib/helcim/client";
import type { HelcimCredentials } from "@/lib/helcim/types";

export async function POST(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    let apiToken = String(body.apiToken || "").trim();

    // Fall back to the stored token if the UI didn't send a fresh one.
    if (!apiToken) {
      const row = await prisma.tenantPaymentProvider.findFirst({
        where: {
          tenantId: session.tenantId,
          capability: "CARD",
          processor: "HELCIM",
        },
        select: { credentialsEnc: true },
      });
      if (row) {
        const creds = kybDecryptJson<HelcimCredentials>(row.credentialsEnc);
        if (creds?.apiToken) apiToken = creds.apiToken;
      }
    }

    if (!apiToken) {
      return NextResponse.json(
        { ok: false, error: "No API token provided or stored" },
        { status: 400 }
      );
    }

    const result = await testHelcimApiToken(apiToken);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[HELCIM-TEST] error:", error);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
