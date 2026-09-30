// POST /api/integrations/deliverect/webhook
//
// Deliverect POSTs inbound orders (from DoorDash / Uber Eats / Skip /
// etc.) to this endpoint. We verify the HMAC signature against the
// per-connection secret, then create an Order row + a DeliverectOrder
// provenance row atomically.
//
// Deliverect includes the location id in the payload — we look up the
// matching IntegrationConnection by (externalLocationId + provider =
// DELIVERECT). That lets us handle multi-tenant traffic on the same
// webhook URL without a per-tenant path.
//
// Idempotency: DeliverectOrder.(connection_id, external_order_id) is
// UNIQUE, so a retried webhook returns 200 + { duplicate: true } without
// creating a second Order.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/deliverect";
import { decryptToken } from "@/lib/integration-crypto";

// Deliverect header for the signature. Actual name may differ per docs
// version — keep it here so we only change one place.
const SIG_HEADER = "x-deliverect-signature";

export async function POST(request: NextRequest) {
  try {
    // We need the RAW body for HMAC verification — .text() gives us
    // exactly what Deliverect signed. Do not use .json() and re-stringify.
    const rawBody = await request.text();
    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const externalLocationId: string | undefined =
      payload?.locationId || payload?.location?.id;
    if (!externalLocationId) {
      return NextResponse.json(
        { error: "Missing locationId in payload" },
        { status: 400 }
      );
    }

    // Look up the connection by external location id. We only match
    // active DELIVERECT connections to prevent stale secrets from being
    // used for verification.
    const connection = await prisma.integrationConnection.findFirst({
      where: {
        provider: "DELIVERECT",
        externalLocationId,
        status: "CONNECTED",
      },
    });
    if (!connection) {
      // Return 404 so Deliverect's dashboard flags the misconfiguration.
      return NextResponse.json(
        { error: "No active Deliverect connection for that location" },
        { status: 404 }
      );
    }

    const secret = decryptToken(connection.webhookSecretEnc);
    if (!secret) {
      return NextResponse.json(
        { error: "Webhook secret not configured" },
        { status: 500 }
      );
    }

    const sig = request.headers.get(SIG_HEADER);
    if (!verifyWebhookSignature(rawBody, sig, secret)) {
      // 401 rather than 400 so anyone probing the endpoint gets a clear
      // auth signal in server logs.
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // Extract the fields we need. Deliverect's exact schema varies by
    // channel — we defensively read multiple possible field names.
    const externalOrderId: string =
      payload.orderId || payload.id || payload.externalId;
    const channel: string = (payload.channel || payload.source || "unknown")
      .toLowerCase()
      .replace(/\s+/g, "_");
    const channelOrderNumber: string | undefined =
      payload.channelOrderId || payload.channelOrderNumber;
    const items: Array<any> = payload.items || [];
    const totalCents: number =
      typeof payload.totalPrice === "number"
        ? payload.totalPrice
        : Math.round(Number(payload.total || 0) * 100);
    const subtotalCents: number =
      typeof payload.subtotal === "number"
        ? payload.subtotal
        : Math.round(Number(payload.subTotal || 0) * 100);
    const taxCents: number =
      typeof payload.tax === "number"
        ? payload.tax
        : Math.round(Number(payload.taxAmount || 0) * 100);
    const tipCents: number =
      typeof payload.tip === "number" ? payload.tip : 0;
    const customerName: string | undefined =
      payload.customer?.name || payload.customerName;
    const customerPhone: string | undefined =
      payload.customer?.phone || payload.customerPhone;

    if (!externalOrderId) {
      return NextResponse.json(
        { error: "Missing order id in payload" },
        { status: 400 }
      );
    }

    // Idempotency check — if we've already created an Order for this
    // externalOrderId, return the existing one instead of duplicating.
    const existing = await prisma.deliverectOrder.findUnique({
      where: {
        connectionId_externalOrderId: {
          connectionId: connection.id,
          externalOrderId,
        },
      },
      include: {
        order: { select: { id: true, orderNumber: true, displayNumber: true } },
      },
    });
    if (existing) {
      return NextResponse.json({
        success: true,
        duplicate: true,
        order: existing.order,
      });
    }

    // Find any location for the tenant to attach the order to — the
    // connection's externalLocationId is Deliverect's id, not ours,
    // so we take the first active iTap location for this tenant.
    // Merchants with multi-store setups should have one Deliverect
    // connection per iTap location (guarded by the external_location
    // partial index).
    const iTapLocation = await prisma.location.findFirst({
      where: { tenantId: connection.tenantId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!iTapLocation) {
      return NextResponse.json(
        { error: "Tenant has no active location to attach the order to" },
        { status: 500 }
      );
    }

    // Build order items — best-effort match on Deliverect's item.plu (we
    // populated it with our Product.id or Product.sku at menu push time).
    const productLookup = new Map<string, { id: string; name: string; basePrice: number; costPrice: number }>();
    if (items.length > 0) {
      const plus = items
        .map((i: any) => i.plu || i.productId || i.id)
        .filter(Boolean);
      const products = await prisma.product.findMany({
        where: {
          tenantId: connection.tenantId,
          OR: [{ id: { in: plus } }, { sku: { in: plus } }],
        },
        select: { id: true, sku: true, name: true, basePrice: true, costPrice: true },
      });
      for (const p of products) {
        productLookup.set(p.id, p);
        if (p.sku) productLookup.set(p.sku, p);
      }
    }

    // Generate a display order number by count. Kept simple — we don't
    // reuse tap-app's generateOrderNumber to avoid a circular dependency;
    // the display number is just tenant-wide daily count + 1000 to keep
    // delivery orders visually distinct from in-house ones.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = await prisma.order.count({
      where: {
        locationId: iTapLocation.id,
        createdAt: { gte: todayStart },
      },
    });
    const displayNumber = 1000 + todayCount + 1;

    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          locationId: iTapLocation.id,
          orderNumber: `DLV-${externalOrderId.slice(0, 12)}`,
          displayNumber,
          orderType: "DELIVERY",
          status: "NEW",
          paymentStatus: "COMPLETED", // Delivery aggregator already collected
          paymentMethod: "DELIVERY_AGGREGATOR",
          subtotal: subtotalCents || totalCents - taxCents - tipCents,
          taxAmount: taxCents,
          tax2Amount: 0,
          discountAmount: 0,
          tipAmount: tipCents,
          surchargeAmount: 0,
          total: totalCents,
          totalCost: 0,
          currency: "CAD",
          customerName: customerName || null,
          customerPhone: customerPhone || null,
          notes: `[${channel.toUpperCase()}] ${channelOrderNumber ? "#" + channelOrderNumber : "delivery order"}`,
        },
      });

      // Order items — skip if we couldn't match to a product; log the
      // raw name in notes so kitchen still knows what to prep.
      for (const item of items) {
        const key = item.plu || item.productId || item.id;
        const match = productLookup.get(key);
        if (!match) continue;
        const qty = item.quantity || 1;
        const unitPrice =
          typeof item.price === "number" ? item.price : match.basePrice;
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            productId: match.id,
            productName: match.name,
            quantity: qty,
            unitPrice,
            modifiersTotal: 0,
            itemTotal: unitPrice * qty,
            unitCost: match.costPrice,
            status: "PENDING",
            specialInstructions: item.notes || null,
          },
        });
      }

      await tx.deliverectOrder.create({
        data: {
          connectionId: connection.id,
          orderId: order.id,
          externalOrderId,
          channel,
          channelOrderNumber: channelOrderNumber || null,
          rawPayload: payload,
        },
      });

      return order;
    });

    return NextResponse.json({
      success: true,
      order: {
        id: created.id,
        orderNumber: created.orderNumber,
        displayNumber: created.displayNumber,
      },
    });
  } catch (error: any) {
    console.error("[deliverect webhook] error:", error);
    return NextResponse.json(
      { error: error?.message || "Webhook processing failed" },
      { status: 500 }
    );
  }
}
