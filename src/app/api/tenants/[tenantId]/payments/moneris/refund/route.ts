// POST /api/tenants/[tenantId]/payments/moneris/refund
//
// Refund a prior Moneris purchase on the terminal. Cardholder must be
// present (Moneris + every card network require card-present refunds).
// Blocks up to 120s while the customer taps the same card they used
// originally; final approval status returned synchronously.
//
// Body: { billId: string, amount?: number (cents) }
//   billId       — id of the uci_bills row from the original purchase
//   amount       — optional partial refund amount; omit for full refund
//
// Persists a linked refund row in uci_bills (status REFUNDED) with a
// reference back to the original bill so the receipt + history views
// can show the pair.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { getActiveProvider } from "@/lib/payment-providers/provider-router";
import {
  refundOnTerminal,
  MonerisApiError,
  MonerisTerminalBusyError,
  type MonerisCredentials,
} from "@/lib/moneris";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const body = await request.json().catch(() => ({}));
  const { billId, amount } = body as { billId?: string; amount?: number };

  if (!billId) {
    return NextResponse.json({ error: "billId is required" }, { status: 400 });
  }
  if (amount !== undefined && (typeof amount !== "number" || amount <= 0)) {
    return NextResponse.json(
      { error: "amount must be a positive number of cents when supplied" },
      { status: 400 }
    );
  }

  // Load the original bill — tenant-scoped so a stolen billId from
  // another tenant returns 404, not 200.
  const originalRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, tenant_id, terminal_id, order_id, amount, currency,
            status, gp_bill_id, request_payload
       FROM uci_bills
      WHERE id = $1::uuid AND tenant_id = $2::uuid`,
    billId,
    tenantId
  );
  if (originalRows.length === 0) {
    return NextResponse.json({ error: "Original bill not found" }, { status: 404 });
  }
  const original = originalRows[0];
  if (original.status !== "PAID") {
    return NextResponse.json(
      { error: `Cannot refund a bill in ${original.status} state` },
      { status: 409 }
    );
  }

  // Refund headroom — the sum of prior linked refunds must not exceed the
  // original amount. Prior refunds have parent_bill_id = billId.
  const priorRefunds: Array<{ sum: bigint }> = await prisma.$queryRawUnsafe(
    `SELECT COALESCE(SUM(amount), 0)::bigint AS sum
       FROM uci_bills
      WHERE parent_bill_id = $1::uuid
        AND status IN ('REFUNDED', 'PENDING')`,
    billId
  );
  const alreadyRefunded = Number(priorRefunds[0]?.sum ?? 0);
  const refundAmount = amount ?? original.amount;
  if (alreadyRefunded + refundAmount > original.amount) {
    return NextResponse.json(
      {
        error: `Refund would exceed the original charge. Available: ${
          original.amount - alreadyRefunded
        } cents.`,
      },
      { status: 400 }
    );
  }

  // Reload Moneris credentials — provider router caches for 60s so this
  // is almost always cheap.
  let activeProvider: Awaited<ReturnType<typeof getActiveProvider>>;
  try {
    activeProvider = await getActiveProvider({ tenantId, capability: "CARD" });
  } catch (routerErr) {
    return NextResponse.json(
      {
        error:
          "Payment provider credentials could not be resolved for this tenant. " +
          (routerErr as Error).message,
      },
      { status: 500 }
    );
  }
  if (!activeProvider || activeProvider.processor !== "MONERIS") {
    return NextResponse.json(
      {
        error: `This endpoint handles Moneris only. Active provider is '${
          activeProvider?.processor ?? "none"
        }'.`,
      },
      { status: 400 }
    );
  }
  const monerisCreds = activeProvider.credentials as unknown as MonerisCredentials;
  if (!monerisCreds?.store_id || !monerisCreds?.api_token || !monerisCreds?.terminal_id) {
    return NextResponse.json(
      { error: "Moneris credentials are incomplete for this tenant." },
      { status: 500 }
    );
  }

  // We link the refund back to the original purchase using the SAME
  // orderId Moneris saw on the original charge — that's how their cloud
  // stitches refunds to purchases. Fall back to the tap-app Order.id
  // when the request payload didn't carry an explicit orderId.
  const originalRequestBody = original.request_payload as Record<string, unknown> | null;
  const originalMonerisOrderId =
    (originalRequestBody?.orderId as string | undefined) ||
    original.order_id ||
    `TXN-${original.id}`;

  try {
    const result = await refundOnTerminal({
      credentials: monerisCreds,
      originalOrderId: originalMonerisOrderId,
      amountCents: refundAmount,
      username: auth.context.userEmail,
    });

    // Approval-derived status. GP uses PENDING → transitions via webhook;
    // Moneris jumps to the final state because we polled to completion.
    const refundStatus = result.approved
      ? "REFUNDED"
      : result.timedOut
        ? "TIMEOUT"
        : result.declined
          ? "DECLINED"
          : "FAILED";

    const inserted: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO uci_bills (
         tenant_id, terminal_id, order_id, parent_bill_id, gp_bill_id,
         amount, currency, line_items, request_payload, response_payload,
         status, txn_type, created_by_id, created_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
         $6, $7, $8::jsonb, $9::jsonb, $10::jsonb,
         $11, 'REFUND', $12::uuid, NOW(), NOW()
       ) RETURNING id, gp_bill_id, status, amount, currency, created_at`,
      tenantId,
      original.terminal_id,
      original.order_id,
      original.id,
      result.cloudTicket ?? result.idempotencyKey,
      refundAmount,
      original.currency,
      JSON.stringify([]),
      JSON.stringify(body),
      JSON.stringify(result.raw || {}),
      refundStatus,
      auth.context.membership.id
    );
    const refundRow = inserted[0];

    return NextResponse.json({
      success: true,
      provider: "MONERIS",
      refund: {
        id: refundRow.id,
        cloudTicket: refundRow.gp_bill_id,
        status: refundRow.status,
        amount: refundRow.amount,
        currency: refundRow.currency,
        parentBillId: original.id,
        createdAt: refundRow.created_at,
      },
      moneris: {
        approved: result.approved,
        declined: result.declined,
        timedOut: result.timedOut,
        statusCode: result.statusCode,
        message: result.message,
        authCode: result.authCode,
        cardType: result.cardType,
        panLast4: result.panLast4,
      },
    });
  } catch (err) {
    if (err instanceof MonerisTerminalBusyError) {
      return NextResponse.json(
        {
          error:
            "Terminal is currently processing another transaction. Wait a moment and try again.",
          code: "TERMINAL_BUSY",
        },
        { status: 409 }
      );
    }
    if (err instanceof MonerisApiError) {
      console.error("[MONERIS REFUND] Moneris API error", {
        statusCode: err.statusCode,
        message: err.message,
        errorDetails: err.errorDetails,
      });
      return NextResponse.json(
        {
          error: `Moneris rejected the refund: ${err.message}`,
          statusCode: err.statusCode,
          errorDetails: err.errorDetails,
        },
        { status: 502 }
      );
    }
    console.error("[MONERIS REFUND] Unexpected error", err);
    return NextResponse.json(
      { error: (err as Error).message || "Refund failed" },
      { status: 500 }
    );
  }
}
