// POST /api/tenants/[tenantId]/payments/moneris/charge
//
// Moneris Go Cloud terminal charge. Blocks until the customer taps card
// or we hit the 120s wall-clock in the client. Returns the final approval
// status synchronously — no POS-side polling required for Moneris because
// the provider client already waits for the terminal.
//
// This route is Moneris-only. GP charges use /uci/bill. The POS should
// call the dispatcher /api/tenants/[tenantId]/payments/charge which
// forwards here based on the tenant's active provider — direct callers
// (curl for testing, admin tools) can hit this endpoint directly.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { getActiveProvider } from "@/lib/payment-providers/provider-router";
import {
  chargeOnTerminal as monerisChargeOnTerminal,
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

  const body = await request.json();
  const { terminalId, orderId } = body as {
    terminalId?: string;
    orderId?: string;
  };

  if (!terminalId) {
    return NextResponse.json({ error: "terminalId is required" }, { status: 400 });
  }

  // Verify terminal belongs to this tenant. Kept independent of GP's
  // terminal shape — Moneris only cares that the terminal row exists for
  // audit; the actual device is identified by credentials.terminal_id.
  const terminalRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT t.id, t.name, t.location_id, l.tenant_id
     FROM terminals t
     JOIN locations l ON t.location_id = l.id
     WHERE t.id = $1::uuid AND l.tenant_id = $2::uuid`,
    terminalId,
    tenantId
  );
  if (terminalRows.length === 0) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }
  const terminal = terminalRows[0];

  // Order lookup (same rules as the GP route — cannot charge a
  // cancelled/completed/paid order).
  let order: any = null;
  if (orderId) {
    order = await prisma.order.findFirst({
      where: { id: orderId, locationId: terminal.location_id },
      include: {
        items: { include: { modifiers: true } },
        location: { select: { tenantId: true } },
      },
    });
    if (!order || order.location.tenantId !== tenantId) {
      return NextResponse.json({ error: "Order not found at this location" }, { status: 404 });
    }
    if (order.status === "CANCELLED" || order.status === "COMPLETED") {
      return NextResponse.json(
        { error: "Cannot charge a cancelled or completed order" },
        { status: 400 }
      );
    }
    if (order.paymentStatus === "PAID") {
      return NextResponse.json({ error: "Order is already paid" }, { status: 400 });
    }
  }

  type LineItemOverride = {
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    seat?: number;
  };
  const override: LineItemOverride[] | undefined = Array.isArray(body.lineItemsOverride)
    ? (body.lineItemsOverride as LineItemOverride[])
    : undefined;

  const lineItems = override?.length
    ? override.map((li) => ({
        name: String(li.name || "Item").slice(0, 50),
        quantity: Math.max(1, Math.round(Number(li.quantity) || 1)),
        unitPrice: Math.max(0, Math.round(Number(li.unitPrice) || 0)),
        lineTotal: Math.max(0, Math.round(Number(li.lineTotal) || 0)),
        seat: typeof li.seat === "number" && li.seat >= 1 ? Math.round(li.seat) : 1,
      }))
    : order?.items.map((i: any) => ({
        name: i.productName + (i.variantName ? ` (${i.variantName})` : ""),
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.itemTotal,
      })) || [];

  const amount = body.amount ?? order?.total ?? 0;
  const currency = order?.currency || "CAD";
  if (amount <= 0) {
    return NextResponse.json({ error: "Amount must be greater than zero" }, { status: 400 });
  }

  // Resolve provider — this endpoint is Moneris-only, so if the tenant
  // has a different active provider we bounce with a clear error rather
  // than silently forwarding.
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
  if (!activeProvider) {
    return NextResponse.json(
      { error: "No CARD payment provider assigned for this tenant." },
      { status: 400 }
    );
  }
  if (activeProvider.processor !== "MONERIS") {
    return NextResponse.json(
      {
        error: `This endpoint handles Moneris only. Active provider is '${activeProvider.processor}'. Use /api/tenants/${tenantId}/payments/charge (dispatcher) instead.`,
      },
      { status: 400 }
    );
  }

  const monerisCreds = activeProvider.credentials as unknown as MonerisCredentials;
  if (!monerisCreds?.store_id || !monerisCreds?.api_token || !monerisCreds?.terminal_id) {
    return NextResponse.json(
      {
        error:
          "Moneris credentials are incomplete for this tenant. Re-enter them from the admin panel.",
      },
      { status: 500 }
    );
  }

  try {
    const result = await monerisChargeOnTerminal({
      credentials: monerisCreds,
      orderId: order?.id || `TXN-${Date.now()}`,
      amountCents: amount,
      username: auth.context.userEmail,
    });

    // Map Moneris final state → uci_bills.status so the receipt + history
    // views work uniformly across providers. GP uses PENDING then flips
    // via webhook; Moneris jumps straight to the final state because we
    // waited on the terminal.
    const billStatus = result.approved
      ? "PAID"
      : result.timedOut
        ? "TIMEOUT"
        : result.declined
          ? "DECLINED"
          : "FAILED";

    const inserted: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO uci_bills (
         tenant_id, terminal_id, order_id, gp_bill_id,
         amount, currency, line_items, request_payload, response_payload,
         status, created_by_id, created_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4,
         $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
         $10, $11::uuid, NOW(), NOW()
       ) RETURNING id, gp_bill_id, status, amount, currency, created_at`,
      tenantId,
      terminalId,
      order?.id || null,
      // gp_bill_id column doubles as generic provider reference — Moneris
      // stores its cloudTicket here so reconciliation still has a key.
      result.cloudTicket ?? result.idempotencyKey,
      amount,
      currency,
      JSON.stringify(lineItems),
      JSON.stringify(body),
      JSON.stringify(result.raw || {}),
      billStatus,
      auth.context.membership.id
    );
    const bill = inserted[0];

    return NextResponse.json({
      success: true,
      provider: "MONERIS",
      bill: {
        id: bill.id,
        gpBillId: bill.gp_bill_id, // cloudTicket for Moneris
        status: bill.status,
        amount: bill.amount,
        currency: bill.currency,
        createdAt: bill.created_at,
        terminal: {
          id: terminal.id,
          name: terminal.name,
        },
      },
      // Moneris-only receipt extras so POS can display the outcome inline
      // without waiting for a webhook (unlike GP).
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
      dryRun: false,
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
      console.error("[MONERIS CHARGE] Moneris API error", {
        statusCode: err.statusCode,
        message: err.message,
        errorDetails: err.errorDetails,
      });
      return NextResponse.json(
        {
          error: `Moneris rejected the request: ${err.message}`,
          statusCode: err.statusCode,
          errorDetails: err.errorDetails,
        },
        { status: 502 }
      );
    }
    console.error("[MONERIS CHARGE] Unexpected error", err);
    return NextResponse.json(
      { error: (err as Error).message || "Charge failed" },
      { status: 500 }
    );
  }
}
