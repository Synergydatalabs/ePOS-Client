// GET  /api/tenants/[tenantId]/marketplace/orders/[orderId]/messages
// POST /api/tenants/[tenantId]/marketplace/orders/[orderId]/messages
//
// Merchant-side PO message thread. Every message written from this
// endpoint is stamped senderSide = MERCHANT — the DB has no way for a
// merchant token to post a message as SUPPLIER.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { listPoMessages, postPoMessage } from "@/lib/po-messages";

async function loadOwnedPoLite(merchantTenantId: string, orderId: string) {
  return prisma.purchaseOrder.findFirst({
    where: { id: orderId, merchantTenantId },
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
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const po = await loadOwnedPoLite(tenantId, orderId);
    if (!po) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const messages = await listPoMessages(po.id);
    return NextResponse.json({ success: true, messages });
  } catch (error: any) {
    console.error("[MERCHANT-PO-MSG] GET error:", error);
    return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
  }
}

// --- POST (send) -----------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const po = await loadOwnedPoLite(tenantId, orderId);
    if (!po) return NextResponse.json({ error: "Order not found" }, { status: 404 });

    const body = await request.json();

    // Resolve sender display name from the membership record. Falls back
    // to email if names aren't set on the profile.
    const member = await prisma.membership.findUnique({
      where: { id: auth.context.membership.id },
      select: { firstName: true, lastName: true, email: true },
    });
    const senderName =
      [member?.firstName, member?.lastName].filter(Boolean).join(" ").trim() ||
      member?.email ||
      "Merchant";

    const result = await postPoMessage({
      purchaseOrderId: po.id,
      poNumber: po.poNumber,
      senderSide: "MERCHANT",
      senderMembershipId: auth.context.membership.id,
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
    console.error("[MERCHANT-PO-MSG] POST error:", error);
    return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
  }
}
