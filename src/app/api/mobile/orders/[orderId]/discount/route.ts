// POST   /api/mobile/orders/[orderId]/discount  — apply a discount
// DELETE /api/mobile/orders/[orderId]/discount  — clear the discount
//
// Same mutability guard as the tip endpoint: order must still be open
// (status NEW/CONFIRMED/PREPARING and paymentStatus != COMPLETED). A
// closed order can't have money "taken back" via this path — issue a
// refund instead.
//
// POST body: { type: "PERCENT" | "AMOUNT", value: number, reason?: string }
//   PERCENT: value = whole-number percent applied to the CURRENT subtotal
//            (e.g. value:10 on a $50 subtotal → $5.00 off). Clamped to
//            0..100 to prevent negative totals.
//   AMOUNT:  value = discount in cents (e.g. value:500 → $5.00 off).
//            Clamped to subtotal so we can't drive the order negative
//            when the operator over-discounts.
//   reason:  optional free-text stored on order.notes with a "Discount:"
//            prefix, so it shows on receipts / audit trails without
//            needing a new schema column.
//
// Discount is stored as resolved cents in Order.discountAmount, then
// recomputeOrderTotals() re-derives subtotal/tax/tax2/total. Tax
// automatically drops to the discounted taxable base — resolveTax()
// takes `discountAmount` and pro-rates accordingly.
//
// Response: { ok, discountAmount, totals }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";
import { recomputeOrderTotals } from "@/lib/mobile-order-totals";

export const dynamic = "force-dynamic";

const MUTABLE_STATUSES = new Set(["NEW", "CONFIRMED", "PREPARING"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId } = await params;
  const body = await request.json().catch(() => ({}));
  const type = typeof body.type === "string" ? body.type.toUpperCase() : "";
  const rawValue = Number(body.value);
  const reason =
    typeof body.reason === "string" && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 200)
      : null;

  if (type !== "PERCENT" && type !== "AMOUNT") {
    return NextResponse.json(
      { error: 'type must be "PERCENT" or "AMOUNT"' },
      { status: 400 }
    );
  }
  if (!Number.isFinite(rawValue) || rawValue <= 0) {
    return NextResponse.json(
      { error: "value must be a positive number" },
      { status: 400 }
    );
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, locationId: ctx.ctx.locationId },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      subtotal: true,
      notes: true,
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.paymentStatus === "COMPLETED") {
    return NextResponse.json(
      { error: "Cannot discount a paid order — issue a refund instead" },
      { status: 400 }
    );
  }
  if (!MUTABLE_STATUSES.has(order.status)) {
    return NextResponse.json(
      { error: `Cannot modify a ${order.status.toLowerCase()} order` },
      { status: 400 }
    );
  }
  if (order.subtotal <= 0) {
    return NextResponse.json(
      { error: "Add items before applying a discount" },
      { status: 400 }
    );
  }

  // Resolve discount to cents. Clamp both paths to [0, subtotal] so the
  // order can never go negative and the tax base stays sane.
  let discountCents: number;
  if (type === "PERCENT") {
    const pct = Math.min(100, Math.max(0, rawValue));
    discountCents = Math.round((order.subtotal * pct) / 100);
  } else {
    discountCents = Math.min(order.subtotal, Math.max(0, Math.floor(rawValue)));
  }

  // Preserve the reason on order.notes with a marker so we can strip it
  // out later if the discount is cleared. Format: "Discount: <reason>".
  // If the notes already carry a discount marker (operator re-applying),
  // replace that line; otherwise append. Keeps other notes intact.
  const nextNotes = mergeDiscountReasonIntoNotes(order.notes, reason);

  await prisma.order.update({
    where: { id: orderId },
    data: {
      discountAmount: discountCents,
      notes: nextNotes,
    },
  });

  const totals = await recomputeOrderTotals(orderId);
  return NextResponse.json({
    ok: true,
    discountAmount: discountCents,
    reason,
    totals,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId } = await params;

  const order = await prisma.order.findFirst({
    where: { id: orderId, locationId: ctx.ctx.locationId },
    select: { id: true, status: true, paymentStatus: true, notes: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.paymentStatus === "COMPLETED") {
    return NextResponse.json(
      { error: "Cannot modify a paid order" },
      { status: 400 }
    );
  }
  if (!MUTABLE_STATUSES.has(order.status)) {
    return NextResponse.json(
      { error: `Cannot modify a ${order.status.toLowerCase()} order` },
      { status: 400 }
    );
  }

  const cleanedNotes = stripDiscountReasonFromNotes(order.notes);

  await prisma.order.update({
    where: { id: orderId },
    data: {
      discountAmount: 0,
      notes: cleanedNotes,
    },
  });

  const totals = await recomputeOrderTotals(orderId);
  return NextResponse.json({ ok: true, discountAmount: 0, totals });
}

/**
 * Keep other notes intact; replace any prior "Discount:" line with the
 * new reason (or drop it entirely when reason is null).
 */
function mergeDiscountReasonIntoNotes(
  existing: string | null,
  reason: string | null
): string | null {
  const clean = stripDiscountReasonFromNotes(existing);
  if (!reason) return clean;
  const line = `Discount: ${reason}`;
  return clean ? `${clean}\n${line}` : line;
}

function stripDiscountReasonFromNotes(existing: string | null): string | null {
  if (!existing) return null;
  const kept = existing
    .split(/\r?\n/)
    .filter((l) => !l.startsWith("Discount:"))
    .join("\n")
    .trim();
  return kept.length > 0 ? kept : null;
}
