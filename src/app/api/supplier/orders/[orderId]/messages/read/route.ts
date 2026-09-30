// POST /api/supplier/orders/[orderId]/messages/read
//
// Marks every MERCHANT-sent message on this PO as read by the supplier
// side. Mirror of the merchant read endpoint.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { markPoMessagesRead } from "@/lib/po-messages";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { orderId } = await params;

    const po = await prisma.purchaseOrder.findFirst({
      where: { id: orderId, supplierTenantId: auth.tenant.id },
      select: { id: true },
    });
    if (!po) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const { markedCount } = await markPoMessagesRead({
      purchaseOrderId: po.id,
      viewerSide: "SUPPLIER",
    });
    return NextResponse.json({ success: true, markedCount });
  } catch (error: any) {
    console.error("[SUPPLIER-PO-MSG] READ error:", error);
    return NextResponse.json({ error: "Failed to mark read" }, { status: 500 });
  }
}
