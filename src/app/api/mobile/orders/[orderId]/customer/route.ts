// POST   /api/mobile/orders/[orderId]/customer  — attach customer info
// DELETE /api/mobile/orders/[orderId]/customer  — clear customer info
//
// Order.customerName/customerPhone/customerEmail are the source of truth
// for "who is this order for" (same shape the web POS + KYB flows use).
// No separate Customer model in this schema — the picker just derives a
// customer list from past distinct order rows (see ../../customers/route).
//
// POST body: { name?, phone?, email? } — at least one non-blank field
// required so we don't overwrite existing info with all-nulls by accident.
//
// Unlike the tip/discount endpoints, customer info CAN be updated after
// a payment lands (an operator might attach the customer after the fact
// for a receipt email or loyalty backfill). So mutability is looser:
// blocked only for CANCELLED orders.
//
// Response: { ok, customer: { name, phone, email } }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId } = await params;
  const body = await request.json().catch(() => ({}));

  const name = normalizeField(body.name, 255);
  const phone = normalizeField(body.phone, 20);
  const email = normalizeField(body.email, 255);

  if (!name && !phone && !email) {
    return NextResponse.json(
      { error: "Provide at least one of name, phone, or email" },
      { status: 400 }
    );
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, locationId: ctx.ctx.locationId },
    select: { id: true, status: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json(
      { error: "Cannot modify a cancelled order" },
      { status: 400 }
    );
  }

  const updated = await prisma.order.update({
    where: { id: orderId },
    data: {
      customerName: name,
      customerPhone: phone,
      customerEmail: email,
    },
    select: {
      customerName: true,
      customerPhone: true,
      customerEmail: true,
    },
  });

  return NextResponse.json({
    ok: true,
    customer: {
      name: updated.customerName,
      phone: updated.customerPhone,
      email: updated.customerEmail,
    },
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
    select: { id: true, status: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json(
      { error: "Cannot modify a cancelled order" },
      { status: 400 }
    );
  }

  await prisma.order.update({
    where: { id: orderId },
    data: {
      customerName: null,
      customerPhone: null,
      customerEmail: null,
    },
  });

  return NextResponse.json({ ok: true });
}

/**
 * Trim + length-clamp + coerce empty string to null so downstream code
 * doesn't have to guard against blank-but-truthy values.
 */
function normalizeField(input: unknown, maxLen: number): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}
