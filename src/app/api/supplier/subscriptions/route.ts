// GET /api/supplier/subscriptions — list this supplier's subscriptions.
// Filters:
//   ?status=ACTIVE|PENDING_ACTIVATION|PAST_DUE|CANCELLED
//   ?search=<free-text>  (matches customer name/email/company)
//   ?limit / ?cursor

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";

export async function GET(request: NextRequest) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || undefined;
  const search = searchParams.get("search")?.trim() || "";
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50", 10), 1), 200);
  const cursor = searchParams.get("cursor") || undefined;

  const where: any = { supplierTenantId: auth.tenant.id };
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { customerName:    { contains: search, mode: "insensitive" } },
      { customerEmail:   { contains: search, mode: "insensitive" } },
      { customerCompany: { contains: search, mode: "insensitive" } },
    ];
  }

  const subs = await prisma.supplierSubscription.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      customerName: true,
      customerEmail: true,
      customerCompany: true,
      currency: true,
      totalCents: true,
      interval: true,
      intervalCount: true,
      status: true,
      activatedAt: true,
      nextBillingAt: true,
      cancelledAt: true,
      cancelledBy: true,
      createdAt: true,
      _count: { select: { invoices: true } },
    },
  });

  return NextResponse.json({
    success: true,
    subscriptions: subs,
    nextCursor: subs.length === limit ? subs[subs.length - 1].id : null,
  });
}
