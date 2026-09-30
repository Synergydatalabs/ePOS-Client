// POST /api/tenants/[tenantId]/payments/uci/batch-close
//
// End-of-day settlement for a UCI terminal. Pass `{ terminalId }` in the
// body (or let it default to the tenant's default UCI terminal). Wraps GP's
// BATCH_CLOSE action_type. Returns the GP DVC + settlement raw response so
// the UI can display it.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { batchClose } from "@/lib/gp-uci";

type Params = { params: Promise<{ tenantId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { tenantId } = await params;

  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const body = await request.json().catch(() => ({}));
  const { terminalId } = body as { terminalId?: string };

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
      { error: "No UCI terminal found for this tenant." },
      { status: 404 }
    );
  }

  try {
    const gpResp = await batchClose(terminal.uci_lane);

    // Record the close as a terminal_transactions row so it's auditable —
    // BATCH_CLOSE doesn't have a payment_id but we still want a trail.
    try {
      await prisma.$queryRawUnsafe(
        `INSERT INTO terminal_transactions (
            terminal_id, command, request_id, request_payload, response_payload,
            result, status, sent_at, responded_at
          ) VALUES (
            $1::uuid, 'BATCH_CLOSE', $2, $3::jsonb, $4::jsonb,
            'SUCCESS', 'SUCCESS', NOW(), NOW()
          )`,
        terminal.id,
        `batch-${Date.now()}`,
        JSON.stringify({ action_type: "BATCH_CLOSE", device_reference: terminal.uci_lane }),
        JSON.stringify(gpResp || {})
      );
    } catch (auditErr) {
      // Audit row is nice-to-have; don't block the response.
      console.error("[BATCH CLOSE] audit insert failed:", auditErr);
    }

    return NextResponse.json({
      success: true,
      dvcId: gpResp.id || null,
      terminal: {
        id: terminal.id,
        name: terminal.name,
        lane: terminal.uci_lane,
      },
      raw: gpResp || null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[BATCH CLOSE] failed:", message);
    return NextResponse.json(
      { error: `BATCH_CLOSE failed: ${message}`, source: "gp" },
      { status: 502 }
    );
  }
}
