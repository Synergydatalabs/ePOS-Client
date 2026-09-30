// POST /api/tenants/[tenantId]/payments/uci/bill
// Create a new UCI bill — pushes an open check to a specific terminal.
// Returns immediately with a billId; the actual payment completes
// asynchronously via the webhook.
//
// Phase 2d: consults the payment-provider router first. When the tenant
// has an active CARD provider assigned via tapapp-admin, we route the call
// through that provider's decrypted per-tenant credentials. When no
// provider is assigned, we return a clear 400 (rather than silently
// falling back to the env credentials — that would let an untenanted call
// slip through to the shared GP account, which is exactly what Phase 2d
// is meant to prevent).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { createBill, chargeOnTerminal } from "@/lib/gp-uci";
import { getActiveProvider } from "@/lib/payment-providers/provider-router";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const body = await request.json();
  const {
    terminalId,
    orderId,
    tipEnabled = true,
    allowSplit = true,
    allowCash = true,
    // "INSTANT" (default) — direct SALE. Customer sees tip picker
    // immediately, taps Skip/Pay, done. No staff walk to the terminal.
    // "CHECK" — legacy CREATE_ORDER flow. Terminal shows a bill the
    // customer has to open first (some fine-dining venues prefer it).
    // Kept as an opt-in so nothing breaks for tenants that were already
    // trained on the check flow.
    mode = "INSTANT",
  } = body as {
    terminalId?: string;
    orderId?: string;
    tipEnabled?: boolean;
    allowSplit?: boolean;
    allowCash?: boolean;
    mode?: "INSTANT" | "CHECK";
  };

  if (!terminalId) {
    return NextResponse.json({ error: "terminalId is required" }, { status: 400 });
  }

  // Verify terminal belongs to this tenant
  const terminalRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT t.id, t.name, t.provider, t.uci_lane, t.uci_merchant_id, t.uci_environment,
            t.location_id, l.tenant_id
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
  if (terminal.provider !== "UCI" || !terminal.uci_lane) {
    return NextResponse.json(
      { error: "Selected terminal is not a UCI terminal" },
      { status: 400 }
    );
  }

  // Load order and verify it's at this terminal's location
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

  // Build line items snapshot. Caller can pass `lineItemsOverride` to drive
  // the breakdown directly from the POS cart (this is how per-seat
  // assignment flows in — OrderItem in our schema doesn't carry a seat
  // number, so the cart is the source of truth at bill-creation time).
  // Each override item: { name, quantity, unitPrice, lineTotal, seat? }
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
  const subtotal = body.subtotal ?? order?.subtotal ?? amount;
  const taxAmount = body.taxAmount ?? order?.taxAmount ?? 0;
  const tax2Amount = body.tax2Amount ?? order?.tax2Amount ?? 0;
  const discountAmount = body.discountAmount ?? order?.discountAmount ?? 0;
  const currency = order?.currency || "CAD";

  if (amount <= 0) {
    return NextResponse.json({ error: "Amount must be greater than zero" }, { status: 400 });
  }

  // Phase 2d — resolve which processor handles CARD for this tenant.
  // Silently accepting a bill without an assigned provider was a Phase 1
  // convenience; Phase 2d makes it explicit so ops know when a tenant
  // hasn't been onboarded yet.
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
      {
        error:
          "No payment provider assigned for this tenant. Assign one from the admin panel first.",
      },
      { status: 400 }
    );
  }
  // This route is GP-only. Non-GP tenants should be dispatched via the
  // provider-agnostic /api/tenants/[tenantId]/payments/charge endpoint,
  // which forwards to the right provider folder (e.g. /moneris/charge).
  // Keeping this file provider-specific means adding future providers is
  // additive — new folder, new registry entry, zero merges into shared code.
  if (activeProvider.processor !== "GP") {
    return NextResponse.json(
      {
        error: `This endpoint handles GP only. Active provider is '${activeProvider.processor}'. Use /api/tenants/${tenantId}/payments/charge (dispatcher) instead.`,
      },
      { status: 400 }
    );
  }

  // GP credentials from the router (per-tenant), or fall through to the
  // env-based defaults if the credentials JSON is empty (unlikely, but
  // keeps the demo tenants without full onboarding working).
  const gpCredentials = {
    app_id: (activeProvider.credentials.app_id as string | undefined) || undefined,
    app_key: (activeProvider.credentials.app_key as string | undefined) || undefined,
    account_name:
      (activeProvider.credentials.account_name as string | undefined) || undefined,
  };

  // Call UCI. Two paths:
  //   INSTANT (default) — direct AUTHORIZE sale. Terminal jumps straight
  //     to the tip picker. Customer taps tip amount or Skip, then Pay.
  //     One touch. This is what busy quick-service and salon staff want.
  //   CHECK — legacy CREATE_ORDER. Terminal shows an "open bill" the
  //     customer opens first, then walks through tip → pay. Kept for the
  //     handful of venues that were trained on it.
  try {
    const gpResponse =
      mode === "CHECK"
        ? await createBill(
            {
              lane: terminal.uci_lane,
              orderNumber: order?.orderNumber || `TXN-${Date.now()}`,
              amount,
              currency,
              lineItems,
              subtotal,
              taxAmount,
              tax2Amount,
              discountAmount,
              tipEnabled,
              allowSplit,
              allowCash,
              metadata: {
                tenantId,
                orderId: order?.id || "",
                terminalId,
              },
            },
            gpCredentials
          )
        : await chargeOnTerminal(terminal.uci_lane, amount, {
            currency,
            reference: order?.orderNumber || `TXN-${Date.now()}`.slice(0, 10),
            credentials: gpCredentials,
          });

    // Persist to uci_bills table
    // 2026-05-29 fix: order_id ($3) needs an explicit ::uuid cast. Without it,
    // passing a real order UUID string from the POS flow throws
    // PrismaClientKnownRequestError (Postgres won't implicitly cast a text
    // param into a uuid column). Admin Test Bills passed NULL so they worked;
    // POS orders failed AFTER GP had already created the bill on the terminal —
    // which is why the bill appeared on the device but the POS showed an error.
    // `$3::uuid` handles both a real UUID and NULL (NULL::uuid is valid).
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
      gpResponse.gpBillId,
      amount,
      currency,
      JSON.stringify(lineItems),
      JSON.stringify(body),
      JSON.stringify(gpResponse.rawResponse || {}),
      gpResponse.status,
      auth.context.membership.id
    );

    const bill = inserted[0];

    return NextResponse.json({
      success: true,
      bill: {
        id: bill.id,
        gpBillId: bill.gp_bill_id,
        status: bill.status,
        amount: bill.amount,
        currency: bill.currency,
        createdAt: bill.created_at,
        terminal: {
          id: terminal.id,
          name: terminal.name,
          lane: terminal.uci_lane,
        },
      },
      dryRun: false,
    });
  } catch (error: any) {
    // 2026-05-29: surface the FULL error so we can tell apart:
    //   - GP rejected the bill (UciApiError, statusCode/errorCode)  → terminal never got it
    //   - GP created it but our DB INSERT failed (PrismaClientKnownRequestError,
    //     .code like P2002 unique / P2003 FK / P2010 raw-query) → bill IS on the
    //     terminal, but we couldn't record it locally
    console.error("[UCI BILL] Create error:", {
      name: error?.name,
      message: error?.message,
      prismaCode: error?.code,             // P2002, P2003, P2010, etc.
      prismaMeta: error?.meta,             // which column/constraint
      uciStatusCode: error?.statusCode,    // GP HTTP status if UciApiError
      uciErrorCode: error?.errorCode,      // GP error_code if UciApiError
    });

    // If the failure is a GP/UCI error, the terminal never got the bill →
    // report a clean terminal error.
    if (error?.name === "UciApiError") {
      return NextResponse.json(
        {
          error: error.message || "Terminal rejected the bill",
          source: "gp",
          statusCode: error.statusCode,
          errorCode: error.errorCode,
        },
        { status: 502 }
      );
    }

    // Otherwise it's a local/DB problem AFTER GP may have already created the
    // bill. Report distinctly so the POS can show "Bill sent — but couldn't be
    // recorded locally" rather than a misleading "terminal failed".
    return NextResponse.json(
      {
        error: error?.message || "Failed to record bill locally",
        source: "local",
        prismaCode: error?.code,
      },
      { status: 500 }
    );
  }
}

// GET /api/tenants/[tenantId]/payments/uci/bill?orderId=xxx
// List bills for a tenant (or filter by order)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId");
  const terminalId = searchParams.get("terminalId");
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);

  const where: string[] = ["b.tenant_id = $1::uuid"];
  const vals: any[] = [tenantId];
  let i = 2;
  if (orderId) {
    where.push(`b.order_id = $${i++}::uuid`);
    vals.push(orderId);
  }
  if (terminalId) {
    where.push(`b.terminal_id = $${i++}::uuid`);
    vals.push(terminalId);
  }
  vals.push(limit);

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT b.id, b.gp_bill_id, b.order_id, b.terminal_id, b.amount, b.tip_amount,
            b.currency, b.status, b.status_reason, b.auth_code, b.card_last4,
            b.card_brand, b.created_at, b.paid_at, b.cancelled_at,
            t.name AS terminal_name, t.uci_lane
     FROM uci_bills b
     LEFT JOIN terminals t ON b.terminal_id = t.id
     WHERE ${where.join(" AND ")}
     ORDER BY b.created_at DESC
     LIMIT $${i}`,
    ...vals
  );

  return NextResponse.json({
    bills: rows.map((r) => ({
      id: r.id,
      gpBillId: r.gp_bill_id,
      orderId: r.order_id,
      terminalId: r.terminal_id,
      terminalName: r.terminal_name,
      lane: r.uci_lane,
      amount: r.amount,
      tipAmount: r.tip_amount,
      currency: r.currency,
      status: r.status,
      statusReason: r.status_reason,
      authCode: r.auth_code,
      cardLast4: r.card_last4,
      cardBrand: r.card_brand,
      createdAt: r.created_at,
      paidAt: r.paid_at,
      cancelledAt: r.cancelled_at,
    })),
  });
}
