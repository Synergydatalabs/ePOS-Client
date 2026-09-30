// POST /api/tenants/[tenantId]/orders/[orderId]/split
//   Create (or replace) the bill split for an order.
//   Body: {
//     splitType: 'EQUAL' | 'BY_GUEST' | 'CUSTOM' | 'SINGLE',
//     splits: Array<{
//       guestName?: string,
//       amount: number,     // cents — server checks sum matches order.total
//       tipAmount?: number, // cents
//     }>
//   }
//   Any prior split is wiped so callers can re-configure freely before
//   payment starts. Locked once ANY splitItem has been paid — server
//   returns 409 in that case.
//
// GET /api/tenants/[tenantId]/orders/[orderId]/split
//   Return the current split with per-item paid state.
//
// DELETE /api/tenants/[tenantId]/orders/[orderId]/split
//   Wipe the split. Blocked if any item has been paid.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; orderId: string }> };

const VALID_TYPES = ["EQUAL", "BY_GUEST", "CUSTOM", "SINGLE"] as const;

// Tolerance for the sum check — split UIs deal in rounding cents (a
// 3-way even split of $10.00 = $3.33 × 3 + a leftover cent) so we
// accept a ±(n-1) cent gap where n is the number of splits.
function isBalanced(
  splitTotal: number,
  orderTotal: number,
  splitCount: number
): boolean {
  return Math.abs(splitTotal - orderTotal) <= Math.max(1, splitCount - 1);
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, orderId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const splitType = body.splitType as (typeof VALID_TYPES)[number];
    const splits = body.splits as Array<{
      guestName?: string;
      amount: number;
      tipAmount?: number;
    }>;

    if (!VALID_TYPES.includes(splitType)) {
      return NextResponse.json(
        { error: `splitType must be one of ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      );
    }
    if (!Array.isArray(splits) || splits.length === 0) {
      return NextResponse.json(
        { error: "splits array is required" },
        { status: 400 }
      );
    }
    if (splits.length > 20) {
      return NextResponse.json(
        { error: "Maximum 20 splits per order" },
        { status: 400 }
      );
    }
    if (splits.some((s) => typeof s.amount !== "number" || s.amount < 0)) {
      return NextResponse.json(
        { error: "Each split must have a non-negative amount" },
        { status: 400 }
      );
    }

    // Verify order + check that no existing splitItem has been paid
    const order = await prisma.order.findFirst({
      where: { id: orderId, location: { tenantId } },
      select: {
        id: true,
        total: true,
        billSplits: {
          include: { items: { select: { status: true } } },
        },
      },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const anyPaid = order.billSplits.some((s) =>
      s.items.some((i) => i.status === "COMPLETED")
    );
    if (anyPaid) {
      return NextResponse.json(
        { error: "Cannot replace split — one or more parts have been paid" },
        { status: 409 }
      );
    }

    const splitTotal = splits.reduce((s, x) => s + x.amount, 0);
    if (!isBalanced(splitTotal, order.total, splits.length)) {
      return NextResponse.json(
        {
          error: `Split amounts sum to ${splitTotal} cents but order total is ${order.total} cents`,
        },
        { status: 400 }
      );
    }

    // Wipe + create in one transaction so a partial state can't be seen
    const [, , created] = await prisma.$transaction([
      prisma.billSplitItem.deleteMany({
        where: { billSplit: { orderId } },
      }),
      prisma.billSplit.deleteMany({ where: { orderId } }),
      prisma.billSplit.create({
        data: {
          orderId,
          splitType,
          items: {
            create: splits.map((s, i) => ({
              guestName: s.guestName?.trim() || `Guest ${i + 1}`,
              amount: s.amount,
              tipAmount: s.tipAmount || 0,
            })),
          },
        },
        include: {
          items: { orderBy: { createdAt: "asc" } },
        },
      }),
    ]);

    return NextResponse.json({ success: true, split: created });
  } catch (error: any) {
    console.error("[split POST] error:", error);
    return NextResponse.json(
      { error: error?.message || "Create split failed" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, orderId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const split = await prisma.billSplit.findFirst({
      where: { orderId, order: { location: { tenantId } } },
      include: {
        items: { orderBy: { createdAt: "asc" } },
      },
    });

    return NextResponse.json({ success: true, split });
  } catch (error: any) {
    console.error("[split GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, orderId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const anyPaid = await prisma.billSplitItem.count({
      where: {
        status: "COMPLETED",
        billSplit: { orderId, order: { location: { tenantId } } },
      },
    });
    if (anyPaid > 0) {
      return NextResponse.json(
        { error: "Cannot delete split — payments already recorded" },
        { status: 409 }
      );
    }

    await prisma.billSplit.deleteMany({
      where: { orderId, order: { location: { tenantId } } },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[split DELETE] error:", error);
    return NextResponse.json(
      { error: error?.message || "Delete failed" },
      { status: 500 }
    );
  }
}
