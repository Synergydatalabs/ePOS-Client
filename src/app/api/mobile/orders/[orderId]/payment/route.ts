// POST /api/mobile/orders/[orderId]/payment
//
// Record a payment against an order (or dispatch a card-present payment
// to a paired terminal). Same semantics as the web POS endpoint at
// tenants/[tenantId]/orders/[orderId]/payment — cumulative COMPLETED
// payments must cover order.total before the order flips to paid, so
// split-tender is supported by calling this multiple times.
//
// Body: { method, amount?, terminalId? }
//   method:
//     CASH       — immediate write; server calculates change from tendered
//     ONLINE     — returns paymentUrl for customer QR scan (Moneris MCO
//                  hosted checkout on the pay page)
//     TERMINAL   — dispatches to the tenant's paired card terminal (GP
//                  UCI today; Moneris DX8000 lands with A4.5). Returns
//                  { pending, billId } — customer taps card at the terminal,
//                  GP webhook writes the Payment row when approved. Mobile
//                  polls GET /orders/[id] to watch for the completed payment.
//   amount:     cents applied. CASH: tendered cents. Defaults to outstanding.
//   terminalId: for TERMINAL; auto-picks the location's ONLINE terminal if
//               only one exists.
//
// Response shape depends on method:
//   CASH     → { success, order, applied, change, remaining, paymentId }
//   ONLINE   → { success, method:"ONLINE", paymentUrl, qrPayload, orderId, remaining }
//   TERMINAL → { success, method:"TERMINAL", pending:true, billId,
//                terminalName, processor, orderId, remaining }

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";
import { applyMobileOrderPayment } from "@/lib/mark-mobile-order-paid";
import { getActiveProvider } from "@/lib/payment-providers/provider-router";
import { chargeOnTerminal as gpChargeOnTerminal } from "@/lib/gp-uci";
import {
  chargeOnTerminal as monerisChargeOnTerminal,
  MonerisApiError,
  MonerisTerminalBusyError,
  type MonerisCredentials,
} from "@/lib/moneris";

export const dynamic = "force-dynamic";

const ALLOWED_METHODS = new Set(["CASH", "ONLINE", "TERMINAL"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId } = await params;
  const body = await request.json().catch(() => ({}));
  const method = typeof body.method === "string" ? body.method.toUpperCase() : "";
  const rawAmount = Number(body.amount);
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? Math.round(rawAmount) : null;
  const requestedTerminalId =
    typeof body.terminalId === "string" && body.terminalId ? body.terminalId : null;

  if (!method) {
    return NextResponse.json({ error: "method is required" }, { status: 400 });
  }
  if (!ALLOWED_METHODS.has(method)) {
    return NextResponse.json(
      { error: `Payment method ${method} not available yet.` },
      { status: 400 }
    );
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, locationId: ctx.ctx.locationId },
    select: {
      id: true,
      orderNumber: true,
      total: true,
      currency: true,
      status: true,
      paymentStatus: true,
      payments: {
        where: { status: "COMPLETED" },
        select: { amount: true },
      },
    },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.total <= 0) {
    return NextResponse.json({ error: "Add items before taking payment" }, { status: 400 });
  }

  const alreadyPaid = order.payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = Math.max(0, order.total - alreadyPaid);
  if (outstanding <= 0) {
    return NextResponse.json({ error: "Order is already fully paid" }, { status: 400 });
  }

  // -------------- ONLINE (Moneris MCO hosted checkout QR) --------------------
  if (method === "ONLINE") {
    const origin =
      request.headers.get("origin") ||
      (request.headers.get("host") ? `https://${request.headers.get("host")}` : "") ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "";
    const paymentUrl = `${origin}/pay/order/${orderId}`;
    return NextResponse.json({
      success: true,
      method: "ONLINE",
      paymentUrl,
      qrPayload: paymentUrl,
      orderId,
      remaining: outstanding,
    });
  }

  // -------------- TERMINAL (GP UCI card-present) -----------------------------
  //
  // Async fire-and-forget: we call chargeOnTerminal (returns ACK immediately),
  // insert the uci_bills row, and return { pending, billId }. The GP webhook
  // writes the real Payment row once the customer taps their card. Mobile
  // polls GET /orders/[id] to detect the completed payment.
  //
  // Duplicates the essential parts of the web POS uci/bill/route.ts. Kept
  // inline for A9.1 MVP — refactor to a shared helper if Moneris DX8000
  // (A4.5) adds a second dispatch path.
  if (method === "TERMINAL") {
    const provider = await getActiveProvider({
      tenantId: ctx.ctx.tenantId,
      capability: "CARD",
    });
    if (!provider) {
      return NextResponse.json(
        {
          error:
            "No active card provider for this tenant. Configure one in the admin portal before taking terminal payments.",
        },
        { status: 400 }
      );
    }
    // Provider-specific dispatch: GP (async) vs Moneris (sync).
    if (provider.processor === "GP") {
      return await dispatchGpTerminal({
        tenantId: ctx.ctx.tenantId,
        locationId: ctx.ctx.locationId,
        memberId: ctx.ctx.session.memberId,
        requestedTerminalId,
        order,
        outstanding,
        credentials: provider.credentials as Record<string, string>,
        orderId,
      });
    }
    if (provider.processor === "MONERIS") {
      return await dispatchMonerisTerminal({
        locationId: ctx.ctx.locationId,
        memberId: ctx.ctx.session.memberId,
        requestedTerminalId,
        order,
        outstanding,
        credentials: provider.credentials as unknown as MonerisCredentials,
        orderId,
      });
    }
    return NextResponse.json(
      {
        error: `Terminal payments not supported for processor ${provider.processor}.`,
        code: "PROCESSOR_NOT_SUPPORTED",
      },
      { status: 400 }
    );
  }

  // -------------- CASH -------------------------------------------------------
  const tendered = amount ?? outstanding;
  const applied = Math.min(tendered, outstanding);
  const change = tendered > outstanding ? tendered - outstanding : 0;

  const result = await applyMobileOrderPayment({
    orderId: order.id,
    method: "CASH",
    applied,
    tendered,
    change,
    performedByMemberId: ctx.ctx.session.memberId,
  });

  return NextResponse.json({
    success: true,
    order: result.order,
    applied: result.applied,
    change: result.change,
    remaining: result.remaining,
    paymentId: result.payment.id,
  });
}

// ---------------------------------------------------------------------------
// GP UCI dispatcher — async: fire and let the webhook settle. Mobile polls
// GET /orders/[id] until Payment lands.
// ---------------------------------------------------------------------------

interface DispatchArgs {
  tenantId: string;
  locationId: string;
  memberId: string;
  requestedTerminalId: string | null;
  order: { id: string; orderNumber: string; currency: string };
  outstanding: number;
  orderId: string;
}

async function dispatchGpTerminal(args: DispatchArgs & { credentials: Record<string, string> }) {
  const terminal = args.requestedTerminalId
    ? await prisma.terminal.findFirst({
        where: {
          id: args.requestedTerminalId,
          locationId: args.locationId,
          provider: "UCI",
        },
        select: { id: true, name: true, status: true, uciLane: true },
      })
    : await prisma.terminal.findFirst({
        where: {
          locationId: args.locationId,
          provider: "UCI",
          status: "ONLINE",
          uciLane: { not: null },
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: { id: true, name: true, status: true, uciLane: true },
      });

  if (!terminal || !terminal.uciLane) {
    return NextResponse.json(
      { error: "No configured GP terminal available at this location." },
      { status: 404 }
    );
  }
  if (terminal.status !== "ONLINE") {
    return NextResponse.json(
      { error: `Terminal "${terminal.name}" is ${terminal.status.toLowerCase()}. Wake it up or pick another terminal.` },
      { status: 409 }
    );
  }

  let gpResponse: Awaited<ReturnType<typeof gpChargeOnTerminal>>;
  try {
    gpResponse = await gpChargeOnTerminal(terminal.uciLane, args.outstanding, {
      currency: args.order.currency,
      reference: args.order.orderNumber.slice(0, 10),
      credentials: args.credentials,
    });
  } catch (err: any) {
    console.error("[mobile TERMINAL GP] chargeOnTerminal failed:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Terminal charge failed" }, { status: 502 });
  }

  try {
    await prisma.$queryRawUnsafe(
      `INSERT INTO uci_bills (
         tenant_id, terminal_id, order_id, gp_bill_id,
         amount, currency, line_items, request_payload, response_payload,
         status, created_by_id, created_at, updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4,
         $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
         $10, $11::uuid, NOW(), NOW()
       )`,
      args.tenantId,
      terminal.id,
      args.order.id,
      gpResponse.gpBillId,
      args.outstanding,
      args.order.currency,
      JSON.stringify([]),
      JSON.stringify({ source: "mobile", terminalId: terminal.id }),
      JSON.stringify(gpResponse.rawResponse || {}),
      gpResponse.status,
      args.memberId
    );
  } catch (err: any) {
    console.error("[mobile TERMINAL GP] uci_bills insert failed:", err?.message || err);
    return NextResponse.json(
      {
        error: "GP terminal received the charge but our record failed to save. Contact support.",
        gpBillId: gpResponse.gpBillId,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    method: "TERMINAL",
    pending: true, // Client must poll — webhook settles
    billId: gpResponse.gpBillId,
    terminalName: terminal.name,
    processor: "GP",
    orderId: args.orderId,
    remaining: args.outstanding,
  });
}

// ---------------------------------------------------------------------------
// Moneris DX8000 dispatcher — SYNCHRONOUS: chargeOnTerminal blocks up to
// ~90s while the cardholder taps/inserts. On approval we immediately write
// the Payment row and return success. Client sees pending:false and skips
// polling.
// ---------------------------------------------------------------------------

async function dispatchMonerisTerminal(args: DispatchArgs & { credentials: MonerisCredentials }) {
  const terminal = args.requestedTerminalId
    ? await prisma.terminal.findFirst({
        where: {
          id: args.requestedTerminalId,
          locationId: args.locationId,
          provider: "MONERIS",
        },
        select: { id: true, name: true, status: true },
      })
    : await prisma.terminal.findFirst({
        where: {
          locationId: args.locationId,
          provider: "MONERIS",
          status: "ONLINE",
        },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: { id: true, name: true, status: true },
      });

  if (!terminal) {
    return NextResponse.json(
      { error: "No configured Moneris terminal available at this location." },
      { status: 404 }
    );
  }
  if (terminal.status !== "ONLINE") {
    return NextResponse.json(
      { error: `Terminal "${terminal.name}" is ${terminal.status.toLowerCase()}. Wake it up or pick another terminal.` },
      { status: 409 }
    );
  }

  try {
    const monerisResult = await monerisChargeOnTerminal({
      credentials: args.credentials,
      orderId: args.order.id,
      amountCents: args.outstanding,
    });

    if (!monerisResult.approved) {
      return NextResponse.json(
        {
          success: false,
          method: "TERMINAL",
          pending: false,
          processor: "MONERIS",
          terminalName: terminal.name,
          error: monerisResult.message || "Payment declined",
        },
        { status: 402 } // 402 Payment Required — soft decline, not a server error
      );
    }

    // Approved — write Payment via shared helper (same code path as CASH
    // + MCO verify so drawer + status logic never drift).
    const result = await applyMobileOrderPayment({
      orderId: args.order.id,
      method: "MONERIS_TERMINAL",
      applied: args.outstanding,
      tendered: args.outstanding,
      change: 0,
      processorReference: monerisResult.cloudTicket ?? monerisResult.idempotencyKey ?? null,
      cardType: monerisResult.cardType ?? null,
      panMasked: monerisResult.panLast4 ? `**** **** **** ${monerisResult.panLast4}` : null,
      performedByMemberId: args.memberId,
      extraMetadata: {
        authCode: monerisResult.authCode,
        statusCode: monerisResult.statusCode,
        terminalId: terminal.id,
      },
    });

    return NextResponse.json({
      success: true,
      method: "TERMINAL",
      pending: false, // Sync — client can navigate straight to OrderPaidScreen
      processor: "MONERIS",
      terminalName: terminal.name,
      applied: result.applied,
      change: 0,
      remaining: result.remaining,
      paymentId: result.payment.id,
      orderId: args.orderId,
    });
  } catch (err: any) {
    console.error("[mobile TERMINAL MONERIS] chargeOnTerminal failed:", err?.message || err);
    if (err instanceof MonerisTerminalBusyError) {
      return NextResponse.json(
        { error: "Terminal is busy — cancel the current transaction and try again." },
        { status: 409 }
      );
    }
    if (err instanceof MonerisApiError) {
      return NextResponse.json(
        { error: `Moneris rejected the charge: ${err.message}` },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { error: err?.message || "Terminal charge failed" },
      { status: 502 }
    );
  }
}
