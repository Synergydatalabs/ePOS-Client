// GET  /api/pay/subscription/[token]  → subscription summary for the cancel page
// POST /api/pay/subscription/[token]/cancel → buyer cancels via signed link
//
// Auth: the token itself is the capability. It's a 48-char hex string
// baked into the buyer's subscription emails and stored on the row. No
// hub login required — this is a public buyer flow (most subscribers
// don't have a hub account).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { cancelSupplierSubscription } from "@/lib/supplier-subscriptions";

type Params = { params: Promise<{ token: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { token } = await params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Invalid cancel link" }, { status: 400 });
  }
  const sub = await prisma.supplierSubscription.findUnique({
    where: { cancelToken: token },
    select: { id: true, status: true, customerEmail: true, customerName: true },
  });
  if (!sub) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }
  if (sub.status === "CANCELLED") {
    return NextResponse.json({ success: true, alreadyCancelled: true });
  }
  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : null;
  await cancelSupplierSubscription({
    subscriptionId: sub.id,
    cancelledBy: "BUYER",
    cancellationReason: reason,
  });
  return NextResponse.json({ success: true });
}
