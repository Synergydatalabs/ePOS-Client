// GET    /api/supplier/subscriptions/[subscriptionId] — one subscription + invoices
// DELETE /api/supplier/subscriptions/[subscriptionId] — cancel (soft)

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { cancelSupplierSubscription } from "@/lib/supplier-subscriptions";

type Params = { params: Promise<{ subscriptionId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;
  const { subscriptionId } = await params;

  const sub = await prisma.supplierSubscription.findFirst({
    where: { id: subscriptionId, supplierTenantId: auth.tenant.id },
    include: {
      invoices: {
        orderBy: { subscriptionSequence: "asc" },
        select: {
          id: true,
          invoiceNumber: true,
          subscriptionSequence: true,
          subscriptionPeriodStart: true,
          subscriptionPeriodEnd: true,
          totalCents: true,
          currency: true,
          paymentStatus: true,
          paidAt: true,
          sentAt: true,
        },
      },
      reminders: {
        orderBy: { sentAt: "desc" },
        select: { id: true, kind: true, invoiceId: true, sentAt: true, succeeded: true },
      },
    },
  });
  if (!sub) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, subscription: sub });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;
  const { subscriptionId } = await params;

  const sub = await prisma.supplierSubscription.findFirst({
    where: { id: subscriptionId, supplierTenantId: auth.tenant.id },
    select: { id: true },
  });
  if (!sub) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : null;
  const cancelled = await cancelSupplierSubscription({
    subscriptionId,
    cancelledBy: "VENDOR",
    cancellationReason: reason,
  });
  return NextResponse.json({ success: true, subscription: cancelled });
}
