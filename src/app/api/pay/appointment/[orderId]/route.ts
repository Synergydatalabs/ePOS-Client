// GET  /api/pay/appointment/[orderId] — public appointment payment info
// POST /api/pay/appointment/[orderId]/mock-pay — dev-only capture
//
// Companion to /pay/appointment/[orderId]/page.tsx. GET returns the
// pending deposit + appointment details so the payment page can render
// without a separate DB call. POST is the temporary mock capture —
// real GP integration replaces the POST handler, response shape stays
// the same.
//
// SECURITY: no auth. The URL contains a UUID that a bot won't guess in
// a reasonable time. When the real GP integration lands, this route
// signs a short-lived token into the URL and verifies it here.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  computeDepositCents,
  depositSettingsFrom,
} from "@/lib/appointment-deposit";

async function loadDepositContext(orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, orderType: "APPOINTMENT" },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentStatus: true,
      subtotal: true,
      total: true,
      currency: true,
      customerName: true,
      customerPhone: true,
      appointmentDate: true,
      appointmentTime: true,
      notes: true,
      location: {
        select: {
          tenantId: true,
          tenant: {
            select: {
              name: true,
              settings: {
                select: {
                  requireAppointmentDeposit: true,
                  appointmentDepositType: true,
                  appointmentDepositValue: true,
                },
              },
            },
          },
        },
      },
      items: {
        select: { productName: true },
      },
    },
  });
  if (!order) return null;
  const depositSettings = depositSettingsFrom(order.location.tenant.settings);
  const depositCents = computeDepositCents(order.subtotal, depositSettings);
  return { order, depositCents };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const ctx = await loadDepositContext(orderId);
  if (!ctx) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
  const { order, depositCents } = ctx;
  return NextResponse.json({
    success: true,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      subtotalCents: order.subtotal,
      totalCents: order.total,
      currency: order.currency,
      appointmentDate: order.appointmentDate,
      appointmentTime: order.appointmentTime,
      customerName: order.customerName,
      customerPhoneMasked: order.customerPhone
        ? `${order.customerPhone.slice(0, 2)}••••${order.customerPhone.slice(-2)}`
        : null,
      serviceNames: order.items.map((i) => i.productName),
      tenantName: order.location.tenant.name,
    },
    deposit: {
      required: depositCents > 0,
      amountCents: depositCents,
      currency: order.currency,
      // Signal to the client whether this deposit has already been paid.
      paid: order.status !== "PENDING_PAYMENT",
    },
  });
}
