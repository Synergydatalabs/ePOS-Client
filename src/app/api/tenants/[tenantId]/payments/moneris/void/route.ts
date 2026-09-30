// POST /api/tenants/[tenantId]/payments/moneris/void
//
// Void a same-day, pre-settlement Moneris purchase. Cheaper than a refund
// at network fees and doesn't leave a matched-pair on the cardholder's
// statement. If Moneris rejects with "batch already closed" (settlement
// window has passed), the caller should fall back to /moneris/refund.
//
// Body: { billId: string }
//   billId — id of the uci_bills row from the original purchase

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { getActiveProvider } from "@/lib/payment-providers/provider-router";
import {
  voidOnTerminal,
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
  const { billId } = body as { billId?: string };
  if (!billId) {
    return NextResponse.json({ error: "billId is required" }, { status: 400 });
  }

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
      { error: `Cannot void a bill in ${original.status} state` },
      { status: 409 }
    );
  }

  // No-op guard — already voided or partially refunded. If any child row
  // exists on this bill, we bail rather than confuse Moneris with a
  // second void attempt.
  const priorChildren: Array<{ n: bigint }> = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS n
       FROM uci_bills
      WHERE parent_bill_id = $1::uuid
        AND status IN ('VOIDED', 'REFUNDED', 'PENDING')`,
    billId
  );
  if (Number(priorChildren[0]?.n ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "This bill already has a void or refund attached. Use /moneris/refund for further adjustments.",
      },
      { status: 409 }
    );
  }

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

  const originalRequestBody = original.request_payload as Record<string, unknown> | null;
  const originalMonerisOrderId =
    (originalRequestBody?.orderId as string | undefined) ||
    original.order_id ||
    `TXN-${original.id}`;

  try {
    const result = await voidOnTerminal({
      credentials: monerisCreds,
      originalOrderId: originalMonerisOrderId,
      username: auth.context.userEmail,
    });

    const voidStatus = result.approved
      ? "VOIDED"
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
         $11, 'VOID', $12::uuid, NOW(), NOW()
       ) RETURNING id, gp_bill_id, status, amount, currency, created_at`,
      tenantId,
      original.terminal_id,
      original.order_id,
      original.id,
      result.cloudTicket ?? result.idempotencyKey,
      original.amount, // void undoes the full original amount
      original.currency,
      JSON.stringify([]),
      JSON.stringify(body),
      JSON.stringify(result.raw || {}),
      voidStatus,
      auth.context.membership.id
    );
    const voidRow = inserted[0];

    return NextResponse.json({
      success: true,
      provider: "MONERIS",
      void: {
        id: voidRow.id,
        cloudTicket: voidRow.gp_bill_id,
        status: voidRow.status,
        amount: voidRow.amount,
        currency: voidRow.currency,
        parentBillId: original.id,
        createdAt: voidRow.created_at,
      },
      moneris: {
        approved: result.approved,
        declined: result.declined,
        timedOut: result.timedOut,
        statusCode: result.statusCode,
        message: result.message,
        authCode: result.authCode,
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
      console.error("[MONERIS VOID] Moneris API error", {
        statusCode: err.statusCode,
        message: err.message,
        errorDetails: err.errorDetails,
      });
      return NextResponse.json(
        {
          error: `Moneris rejected the void: ${err.message}`,
          statusCode: err.statusCode,
          errorDetails: err.errorDetails,
        },
        { status: 502 }
      );
    }
    console.error("[MONERIS VOID] Unexpected error", err);
    return NextResponse.json(
      { error: (err as Error).message || "Void failed" },
      { status: 500 }
    );
  }
}
