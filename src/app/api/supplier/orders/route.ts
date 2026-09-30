// GET /api/supplier/orders
// Lists purchase orders the current supplier tenant has received.
//
// Query params:
//   ?status=SUBMITTED    — filter by exact status
//   ?merchantId=<uuid>   — filter by ordering merchant
//   ?search=xyz          — matches PO number
//
// Line items and full addresses aren't returned here — that's the detail
// endpoint (GET /api/supplier/orders/[orderId]). We keep this list query
// cheap so the inbox loads instantly even with thousands of POs.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { unreadMessageCounts } from "@/lib/po-messages";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const merchantId = searchParams.get("merchantId");
    const search = searchParams.get("search")?.trim();

    const where: any = { supplierTenantId: auth.tenant.id };
    if (status) where.status = status;
    if (merchantId) where.merchantTenantId = merchantId;
    if (search) {
      where.poNumber = { contains: search, mode: "insensitive" };
    }

    const orders = await prisma.purchaseOrder.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      take: 200,
      select: {
        id: true,
        poNumber: true,
        status: true,
        currency: true,
        totalCents: true,
        submittedAt: true,
        acknowledgedAt: true,
        shippedAt: true,
        deliveredAt: true,
        cancelledAt: true,
        expectedDeliveryAt: true,
        // Phase C #67: payment surface for the list row so the supplier
        // can spot paid vs. unpaid POs without opening each one.
        paymentStatus: true,
        paidAt: true,
        merchantTenant: { select: { id: true, name: true } },
        _count: { select: { items: true } },
      },
    });

    // Quick pipeline counts for status tabs — one SQL round-trip, always
    // reflects the FULL set (not the current filter). Same tab counts
    // regardless of what tab is active.
    const rawCounts = await prisma.purchaseOrder.groupBy({
      by: ["status"],
      where: { supplierTenantId: auth.tenant.id },
      _count: true,
    });
    const counts = Object.fromEntries(rawCounts.map((c) => [c.status, c._count]));

    // Attach unread merchant-message counts. Single grouped query keyed
    // by PO id — cheap even when the list has 200 rows.
    const unreadMap = await unreadMessageCounts(
      orders.map((o) => o.id),
      "SUPPLIER"
    );
    const ordersWithUnread = orders.map((o) => ({
      ...o,
      unreadMessageCount: unreadMap.get(o.id) || 0,
    }));

    return NextResponse.json({
      success: true,
      orders: ordersWithUnread,
      counts,
      total: ordersWithUnread.length,
    });
  } catch (error: any) {
    console.error("[SUPPLIER-ORDERS] GET error:", error);
    return NextResponse.json({ error: "Failed to load orders" }, { status: 500 });
  }
}
