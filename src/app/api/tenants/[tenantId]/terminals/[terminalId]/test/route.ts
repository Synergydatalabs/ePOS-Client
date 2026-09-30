// POST /api/tenants/[tenantId]/terminals/[terminalId]/test
// Fires a test action against a UCI terminal so admins can verify wiring
// without a real order. Supports two modes:
//   - { action: "ping" }     → action_type PING
//   - { action: "test_bill", amount?: number } → action_type CREATE_ORDER
//
// Result is returned synchronously (the device command's interim ack from GP),
// not the final terminal outcome. The async result still arrives via webhook.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { createBill, pingTerminal } from "@/lib/gp-uci";

type Params = { params: Promise<{ tenantId: string; terminalId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { tenantId, terminalId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_ADMIN");
  if (!auth.success) return auth.response;

  const { action = "ping", amount = 100 } = await request.json().catch(() => ({}));

  // Look up the terminal
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT t.id, t.name, t.provider, t.uci_lane, t.uci_environment,
            t.location_id, l.tenant_id
     FROM terminals t
     JOIN locations l ON t.location_id = l.id
     WHERE t.id = $1::uuid AND l.tenant_id = $2::uuid`,
    terminalId,
    tenantId
  );

  if (rows.length === 0) {
    return NextResponse.json({ success: false, error: "Terminal not found" }, { status: 404 });
  }
  const terminal = rows[0];

  if (terminal.provider !== "UCI" || !terminal.uci_lane) {
    return NextResponse.json(
      { success: false, error: "Selected terminal is not a UCI terminal" },
      { status: 400 }
    );
  }

  try {
    if (action === "ping") {
      const data = await pingTerminal(terminal.uci_lane);
      return NextResponse.json({
        success: true,
        action: "ping",
        dvcId: data.id,
        status: data.status,
        actionResult: data.action,
        raw: data,
      });
    }

    if (action === "test_bill") {
      const result = await createBill({
        lane: terminal.uci_lane,
        orderNumber: `TEST-${Date.now()}`,
        amount,
        currency: "CAD",
        subtotal: amount,
        taxAmount: 0,
        lineItems: [
          {
            name: "Test Bill",
            quantity: 1,
            unitPrice: amount,
            lineTotal: amount,
          },
        ],
        tipEnabled: true,
        allowSplit: true,
        allowCash: true,
        metadata: {
          tableLabel: "Admin test bill",
          staffName: `${auth.context.membership.firstName || "Admin"}`,
        },
      });

      // Persist a uci_bills row so the webhook can update it later
      await prisma.$queryRawUnsafe(
        `INSERT INTO uci_bills (
           tenant_id, terminal_id, order_id, gp_bill_id,
           amount, currency, line_items, request_payload, response_payload,
           status, created_by_id, created_at, updated_at
         ) VALUES (
           $1::uuid, $2::uuid, NULL, $3,
           $4, 'CAD', $5::jsonb, $6::jsonb, $7::jsonb,
           $8, $9::uuid, NOW(), NOW()
         )`,
        tenantId,
        terminalId,
        result.gpBillId,
        amount,
        JSON.stringify([{ name: "Test Bill", amount }]),
        JSON.stringify({ action, amount, sentBy: "admin-test" }),
        JSON.stringify(result.rawResponse || {}),
        result.status,
        auth.context.membership.id
      );

      return NextResponse.json({
        success: true,
        action: "test_bill",
        dvcId: result.gpBillId,
        status: result.status,
        amount,
        terminal: { name: terminal.name, lane: terminal.uci_lane },
        raw: result.rawResponse,
        hint:
          "Bill sent to terminal. Watch the terminal screen — it should appear as an open check. Final status will arrive via webhook.",
      });
    }

    return NextResponse.json(
      { success: false, error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (err: any) {
    console.error("[TERMINAL TEST] error", err);
    return NextResponse.json(
      {
        success: false,
        action,
        error: err?.message || "Test failed",
        statusCode: err?.statusCode,
        errorCode: err?.errorCode,
      },
      { status: 500 }
    );
  }
}
