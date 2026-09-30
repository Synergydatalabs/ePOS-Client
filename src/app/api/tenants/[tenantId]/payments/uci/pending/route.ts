// GET /api/tenants/[tenantId]/payments/uci/pending?terminalId=xxx
//
// Returns the list of unpaid bills (orders) currently queued on a UCI
// terminal — wraps GP's PENDING_TRANSACTION_LIST action. Each entry tells
// the server which table / clerk / amount the bill is for, so a restaurant
// server can pick one up and run payment against it.
//
// Note: the top-level `id` in GP's PENDING_TRANSACTION_LIST response is a
// 30-character synthetic handle (GP product team is investigating), NOT a
// queryable DVC. The useful payload is `transaction[]` where each entry is
// an actual pending bill with its DVC, check_number, table_number, etc.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { listPendingOrders } from "@/lib/gp-uci";

type Params = { params: Promise<{ tenantId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { tenantId } = await params;

  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const { searchParams } = new URL(request.url);
  const terminalId = searchParams.get("terminalId");

  // Resolve which terminal lane to call. If the caller passed terminalId,
  // use that exact one; otherwise pick the tenant's default UCI terminal so
  // the page can render without forcing the operator to choose first.
  const terminalRows: Array<{ id: string; name: string; uci_lane: string | null }> =
    terminalId
      ? await prisma.$queryRawUnsafe(
          `SELECT id, name, uci_lane
             FROM terminals
            WHERE id = $1::uuid AND tenant_id = $2::uuid AND provider = 'UCI'`,
          terminalId,
          tenantId
        )
      : await prisma.$queryRawUnsafe(
          `SELECT id, name, uci_lane
             FROM terminals
            WHERE tenant_id = $1::uuid AND provider = 'UCI' AND uci_lane IS NOT NULL
            ORDER BY is_default DESC, created_at ASC
            LIMIT 1`,
          tenantId
        );

  const terminal = terminalRows[0];
  if (!terminal || !terminal.uci_lane) {
    return NextResponse.json(
      { error: "No UCI terminal configured for this tenant." },
      { status: 404 }
    );
  }

  try {
    const gpResp = await listPendingOrders(terminal.uci_lane);

    // GP returns { id, action_type, status, transaction: [...] } where each
    // transaction entry is a queued bill on the terminal. Normalize the
    // fields we know about; leave anything unknown in `raw` for debugging.
    const transactions = Array.isArray((gpResp as { transaction?: unknown[] }).transaction)
      ? ((gpResp as { transaction: Array<Record<string, unknown>> }).transaction)
      : [];

    const bills = transactions.map((t) => ({
      dvcId: t.id as string | null,
      checkNumber: (t.check_number as string | null) || null,
      tableNumber: (t.table_number as string | null) || null,
      userReference: (t.user_reference as string | null) || null, // clerk/server
      amount: (t.amount as number | null) ?? null,
      requestedAmount: (t.requested_amount as number | null) ?? null,
      timeCreated: (t.time_created as string | null) || null,
      raw: t,
    }));

    return NextResponse.json({
      success: true,
      terminal: {
        id: terminal.id,
        name: terminal.name,
        lane: terminal.uci_lane,
      },
      count: bills.length,
      bills,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[UCI PENDING] listPendingOrders failed:", message);
    return NextResponse.json(
      { error: `Failed to fetch pending bills: ${message}` },
      { status: 502 }
    );
  }
}
