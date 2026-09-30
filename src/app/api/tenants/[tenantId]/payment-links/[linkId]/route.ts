// PATCH  /api/tenants/[tenantId]/payment-links/[linkId] — cancel a pending link
// DELETE /api/tenants/[tenantId]/payment-links/[linkId] — hard-delete an unpaid link

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; linkId: string }> };

const LINK_MARKER = "[PAYMENT_LINK]";

// Confirm the order is (a) tenant-scoped and (b) actually a payment link.
async function assertLinkForTenant(linkId: string, tenantId: string) {
  const order = await prisma.order.findUnique({
    where: { id: linkId },
    select: {
      id: true,
      notes: true,
      paymentStatus: true,
      status: true,
      location: { select: { tenantId: true } },
    },
  });
  if (!order || order.location.tenantId !== tenantId) return null;
  if (!order.notes || !order.notes.startsWith(LINK_MARKER)) return null;
  return order;
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, linkId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const link = await assertLinkForTenant(linkId, tenantId);
    if (!link) {
      return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { action } = body as { action?: string };

    // Cancel = mark order cancelled + block future payment
    if (action === "cancel") {
      if (link.paymentStatus === "COMPLETED") {
        return NextResponse.json(
          { error: "Cannot cancel — link is already paid" },
          { status: 400 }
        );
      }
      if (link.status === "CANCELLED") {
        return NextResponse.json({ success: true, alreadyCancelled: true });
      }
      const updated = await prisma.order.update({
        where: { id: linkId },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
        },
      });
      return NextResponse.json({ success: true, link: updated });
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error: any) {
    console.error("[payment-links] PATCH error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to update payment link",
        code: error?.code || null,
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, linkId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const link = await assertLinkForTenant(linkId, tenantId);
    if (!link) {
      return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
    }

    if (link.paymentStatus === "COMPLETED") {
      return NextResponse.json(
        { error: "Cannot delete a paid link — cancel or archive instead" },
        { status: 400 }
      );
    }

    // Payment links have no OrderItems (we skip them at creation) so the
    // Order row can be hard-deleted without cascade concerns.
    await prisma.order.delete({ where: { id: linkId } });
    return NextResponse.json({ success: true, deleted: true });
  } catch (error: any) {
    console.error("[payment-links] DELETE error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to delete payment link",
        code: error?.code || null,
      },
      { status: 500 }
    );
  }
}
