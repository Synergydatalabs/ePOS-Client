// GET /api/supplier/payment-links/[id]/webhook-deliveries?limit=50
//
// Phase I #5 v2 (2026-09-14). Delivery log for one link's webhook.
// The row's request_body is the exact bytes we tried to POST;
// response_body is up to 1KB of what the partner sent back.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await getPartnerSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const owns = await prisma.supplierPaymentLink.findFirst({
    where: { id, supplierTenantId: session.tenantId },
    select: { id: true },
  });
  if (!owns) {
    return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit"));
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 200
      ? Math.floor(limitRaw)
      : 50;

  const deliveries = await prisma.webhookDelivery.findMany({
    where: { paymentLinkId: id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      eventType: true,
      eventId: true,
      url: true,
      requestBody: true,
      responseStatus: true,
      responseBody: true,
      durationMs: true,
      attempt: true,
      succeeded: true,
      errorMessage: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ deliveries });
}
