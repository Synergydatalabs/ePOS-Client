// POST /api/tenants/[tenantId]/marketplace/orders/[orderId]/messages/read
//
// Marks every SUPPLIER-sent message on this PO as read by the merchant
// side. Idempotent — already-read messages keep their original timestamp.
// Called when the merchant opens the thread OR posts a reply (client can
// batch that in one round-trip if desired; both are cheap).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { markPoMessagesRead } from "@/lib/po-messages";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: orderId, merchantTenantId: tenantId },
      select: { id: true },
    });
    if (!po) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const { markedCount } = await markPoMessagesRead({
      purchaseOrderId: po.id,
      viewerSide: "MERCHANT",
    });
    return NextResponse.json({ success: true, markedCount });
  } catch (error: any) {
    console.error("[MERCHANT-PO-MSG] READ error:", error);
    return NextResponse.json({ error: "Failed to mark read" }, { status: 500 });
  }
}
