import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; terminalId: string }> };

// GET /api/tenants/[tenantId]/terminals/[terminalId]
export async function GET(request: NextRequest, { params }: Params) {
  const { tenantId, terminalId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  const terminal = await prisma.terminal.findUnique({
    where: { id: terminalId },
    include: {
      location: { select: { id: true, name: true, tenantId: true } },
      transactions: {
        orderBy: { sentAt: "desc" },
        take: 20,
        select: {
          id: true,
          command: true,
          transactionType: true,
          amount: true,
          result: true,
          status: true,
          cardType: true,
          maskedPan: true,
          entryMode: true,
          referenceNumber: true,
          sentAt: true,
          respondedAt: true,
          // Needed so the admin Transactions list can wire up the inline
          // Void / Refund buttons — the payment endpoints are scoped to
          // (orderId, paymentId).
          orderId: true,
          paymentId: true,
          transactionId: true,
          authCode: true,
        },
      },
    },
  });

  if (!terminal || terminal.location.tenantId !== tenantId) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  return NextResponse.json({ terminal });
}

// PUT /api/tenants/[tenantId]/terminals/[terminalId]
export async function PUT(request: NextRequest, { params }: Params) {
  const { tenantId, terminalId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_ADMIN");
  if (!auth.success) return auth.response;

  const body = await request.json();
  const {
    name,
    ipAddress,
    port,
    isDefault,
    ecrId,
    uciLane,
    uciMerchantId,
    uciEnvironment,
    // Moneris-only fields (Device ID + model). Optional on PUT — only
    // written when included on the request body.
    serialNumber,
    model,
  } = body;

  const terminal = await prisma.terminal.findUnique({
    where: { id: terminalId },
    include: { location: { select: { tenantId: true, id: true } } },
  });

  if (!terminal || terminal.location.tenantId !== tenantId) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  // If setting as default, unset other defaults at same location
  if (isDefault) {
    await prisma.terminal.updateMany({
      where: { locationId: terminal.locationId, id: { not: terminalId } },
      data: { isDefault: false },
    });
  }

  // Base fields via Prisma
  await prisma.terminal.update({
    where: { id: terminalId },
    data: {
      ...(name !== undefined && { name }),
      ...(ipAddress !== undefined && { ipAddress }),
      ...(port !== undefined && { port }),
      ...(isDefault !== undefined && { isDefault }),
      ...(ecrId !== undefined && { ecrId }),
      // Moneris: Device ID + model — only touched when included on body.
      ...(serialNumber !== undefined && { serialNumber }),
      ...(model !== undefined && { model }),
    },
  });

  // UCI columns via raw (may not be in Prisma schema yet until db pull)
  if (uciLane !== undefined || uciMerchantId !== undefined || uciEnvironment !== undefined) {
    await prisma.$queryRawUnsafe(
      `UPDATE terminals
       SET uci_lane = COALESCE($1, uci_lane),
           uci_merchant_id = COALESCE($2, uci_merchant_id),
           uci_environment = COALESCE($3, uci_environment),
           updated_at = NOW()
       WHERE id = $4::uuid`,
      uciLane ?? null,
      uciMerchantId ?? null,
      uciEnvironment ?? null,
      terminalId
    );
  }

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, location_id, name, COALESCE(provider, 'UPA') AS provider,
            uci_lane, uci_merchant_id, uci_environment, ip_address, port,
            status, is_default FROM terminals WHERE id = $1::uuid`,
    terminalId
  );

  return NextResponse.json({ terminal: rows[0] });
}

// DELETE /api/tenants/[tenantId]/terminals/[terminalId]
export async function DELETE(request: NextRequest, { params }: Params) {
  const { tenantId, terminalId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_ADMIN");
  if (!auth.success) return auth.response;

  const terminal = await prisma.terminal.findUnique({
    where: { id: terminalId },
    include: { location: { select: { tenantId: true } } },
  });

  if (!terminal || terminal.location.tenantId !== tenantId) {
    return NextResponse.json({ error: "Terminal not found" }, { status: 404 });
  }

  await prisma.terminal.delete({ where: { id: terminalId } });
  return NextResponse.json({ success: true });
}
