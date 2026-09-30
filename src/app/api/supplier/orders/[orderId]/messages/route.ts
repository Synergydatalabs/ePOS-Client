// GET  /api/supplier/orders/[orderId]/messages
// POST /api/supplier/orders/[orderId]/messages
//
// Supplier-side PO message thread. Mirror of the merchant endpoint —
// senderSide is stamped SUPPLIER, ownership check via supplierTenantId.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { listPoMessages, postPoMessage } from "@/lib/po-messages";

async function loadOwnedPoLite(supplierTenantId: string, orderId: string) {
  return prisma.purchaseOrder.findFirst({
    where: { id: orderId, supplierTenantId },
    select: {
      id: true,
      poNumber: true,
      merchantTenantId: true,
      supplierTenantId: true,
    },
  });
}

// --- GET (thread) ----------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { orderId } = await params;

    const po = await loadOwnedPoLite(auth.tenant.id, orderId);
    if (!po) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const messages = await listPoMessages(po.id);
    return NextResponse.json({ success: true, messages });
  } catch (error: any) {
    console.error("[SUPPLIER-PO-MSG] GET error:", error);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}

// --- POST (send) -----------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { orderId } = await params;

    const po = await loadOwnedPoLite(auth.tenant.id, orderId);
    if (!po) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const body = await request.json();

    const senderName =
      [auth.session.firstName, auth.session.lastName].filter(Boolean).join(" ").trim() ||
      auth.session.email ||
      auth.tenant.name ||
      "Supplier";

    const result = await postPoMessage({
      purchaseOrderId: po.id,
      poNumber: po.poNumber,
      senderSide: "SUPPLIER",
      senderMembershipId: auth.session.memberId,
      senderName,
      body: body.body,
      merchantTenantId: po.merchantTenantId,
      supplierTenantId: po.supplierTenantId,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, message: result.message });
  } catch (error: any) {
    console.error("[SUPPLIER-PO-MSG] POST error:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
