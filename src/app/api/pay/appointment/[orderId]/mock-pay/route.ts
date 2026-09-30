// POST /api/pay/appointment/[orderId]/mock-pay
//
// Dev-only "capture" endpoint that simulates a successful deposit
// payment. Marks the order paymentStatus=COMPLETED (deposit received),
// flips status PENDING_PAYMENT → NEW so it appears on the salon board,
// and fires the confirmation SMS the create endpoint skipped.
//
// Real GP swap replaces this route body with a webhook handler that
// verifies signature + amount, then does the same DB transition.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendSms } from "@/lib/sms/client";
import {
  computeDepositCents,
  depositSettingsFrom,
} from "@/lib/appointment-deposit";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const { orderId } = await params;
  const order = await prisma.order.findFirst({
    where: { id: orderId, orderType: "APPOINTMENT" },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      subtotal: true,
      currency: true,
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
      items: { select: { productName: true } },
    },
  });
  if (!order) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
  // Idempotent — repeat capture is a no-op success (browser refresh /
  // customer double-click). Only PENDING_PAYMENT orders are captured
  // via this route; anything else is treated as "already handled".
  if (order.status !== "PENDING_PAYMENT") {
    return NextResponse.json({ success: true, alreadyCaptured: true });
  }

  const deposit = depositSettingsFrom(order.location.tenant.settings);
  const depositCents = computeDepositCents(order.subtotal, deposit);

  // Write the deposit as a COMPLETED Payment row and flip the order to
  // NEW. Deliberately leave paymentStatus at PENDING (not COMPLETED) —
  // the deposit is only a fraction of order.total, so the balance is
  // still owed and the POS payment route computes `outstanding` by
  // subtracting all COMPLETED payments from total. That naturally
  // deducts the deposit from what's charged at the salon.
  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: order.id,
        provider: "mock",
        method: "deposit_online",
        amount: depositCents,
        currency: order.currency,
        status: "COMPLETED",
        completedAt: new Date(),
        metadata: { source: "appointment_deposit_mock" },
      },
    });
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "NEW",
        notes: [
          order.notes,
          `Deposit received: ${order.currency} ${(depositCents / 100).toFixed(2)} (mock capture)`,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    });
  });

  // Fire the confirmation SMS that the create endpoint skipped.
  if (order.customerPhone) {
    void sendSms({
      tenantId: order.location.tenantId,
      to: order.customerPhone,
      body:
        `${order.location.tenant.name}: deposit received. Your appointment ` +
        `${order.appointmentDate?.toISOString().slice(0, 10)} at ${order.appointmentTime} ` +
        `is confirmed. Ref: ${order.orderNumber}`,
      category: "appointment_confirm",
    }).catch((err) =>
      console.warn("[mock-pay] post-capture SMS failed:", err)
    );
  }

  return NextResponse.json({ success: true });
}
