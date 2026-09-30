// POST /api/tenants/[tenantId]/integrations/deliverect/rotate-secret
//   Generate a fresh webhook secret, encrypt + persist, and return the
//   plaintext ONCE so the admin can paste it into Deliverect's
//   dashboard. After this response, the plaintext is not retrievable —
//   they'd have to rotate again.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { rotateWebhookSecret } from "@/lib/deliverect";

type Params = { params: Promise<{ tenantId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const conn = await prisma.integrationConnection.findUnique({
      where: {
        tenantId_provider: { tenantId, provider: "DELIVERECT" },
      },
      select: { id: true },
    });
    if (!conn) {
      return NextResponse.json(
        { error: "Create the connection first (save API credentials)" },
        { status: 404 }
      );
    }

    const secret = await rotateWebhookSecret(conn.id);
    return NextResponse.json({ success: true, webhookSecret: secret });
  } catch (error: any) {
    console.error("[deliverect rotate-secret] error:", error);
    return NextResponse.json(
      { error: error?.message || "Rotate failed" },
      { status: 500 }
    );
  }
}
