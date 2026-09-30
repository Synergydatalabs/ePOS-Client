// POST /api/mobile/orders/[orderId]/items
//
// Add an item to a draft order. A5 (2026-08-18) adds:
//   - variantId?  → priceAdjustment applied to unitPrice
//   - modifiers[] → each {modifierId, quantity?} snapshot-priced into
//                   OrderItemModifier rows and rolled into modifiersTotal
//
// Body: {
//   productId,
//   variantId?,
//   quantity=1,
//   modifiers?: [{ modifierId, quantity? }],
//   specialInstructions?,
//   stack?=true  // legacy — ignored when variantId/modifiers/instructions differ
// }
//
// Stacking rule: only stack lines when the ENTIRE selection matches
// (same productId AND no variant AND no modifiers AND no instructions).
// Any variance forces a new line — matches Square-style UX where "Latte
// medium + oat milk" is a different line from "Latte medium".
//
// Mirrors the web POS math at
// C:\Mod App\tap-app\src\app\api\tenants\[tenantId]\orders\[orderId]\items\route.ts:
//   unitPrice      = product.basePrice + variant.priceAdjustment
//   modifiersTotal = sum(modifier.price * (modifierQty ?? 1))
//   itemTotal      = (unitPrice + modifiersTotal) * quantity
//
// Skip: no server-side validation of ModifierGroup min/max/required —
// web POS doesn't either, and the client can enforce it in the picker UI.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getMobileOrderContext } from "@/lib/mobile-order-context";
import { recomputeOrderTotals } from "@/lib/mobile-order-totals";

export const dynamic = "force-dynamic";

const MUTABLE_STATUSES = new Set(["NEW", "CONFIRMED", "PREPARING"]);

interface ModifierInput {
  modifierId: string;
  quantity?: number;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const ctx = await getMobileOrderContext(request);
  if (!ctx.ok) return ctx.response;

  const { orderId } = await params;
  const body = await request.json().catch(() => ({}));
  const productId = typeof body.productId === "string" ? body.productId : "";
  const variantId = typeof body.variantId === "string" && body.variantId ? body.variantId : null;
  const rawQty = Number(body.quantity ?? 1);
  const quantity = Number.isFinite(rawQty) ? Math.max(1, Math.floor(rawQty)) : 1;
  const specialInstructions =
    typeof body.specialInstructions === "string" && body.specialInstructions.trim().length > 0
      ? body.specialInstructions.trim()
      : null;
  const modifiersInput: ModifierInput[] = Array.isArray(body.modifiers)
    ? (body.modifiers as unknown[]).filter(
        (m): m is ModifierInput =>
          !!m && typeof (m as { modifierId?: unknown }).modifierId === "string"
      )
    : [];

  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: { id: orderId, locationId: ctx.ctx.locationId },
    select: { id: true, status: true, paymentStatus: true },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.paymentStatus === "COMPLETED") {
    return NextResponse.json({ error: "Cannot modify a paid order" }, { status: 400 });
  }
  if (!MUTABLE_STATUSES.has(order.status)) {
    return NextResponse.json(
      { error: `Cannot modify a ${order.status.toLowerCase()} order` },
      { status: 400 }
    );
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, tenantId: ctx.ctx.tenantId, isActive: true },
    select: {
      id: true,
      name: true,
      basePrice: true,
      isAvailable: true,
      costPrice: true,
    },
  });
  if (!product) {
    return NextResponse.json({ error: "Product not found" }, { status: 404 });
  }
  if (!product.isAvailable) {
    return NextResponse.json({ error: `${product.name} is out of stock` }, { status: 409 });
  }

  // Variant lookup — must belong to THIS product to prevent cross-product
  // price manipulation via crafted request.
  let variantName: string | null = null;
  let priceAdjustment = 0;
  if (variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, productId: product.id, isActive: true },
      select: { id: true, name: true, priceAdjustment: true },
    });
    if (!variant) {
      return NextResponse.json(
        { error: "Selected variant is not available for this product" },
        { status: 400 }
      );
    }
    variantName = variant.name;
    priceAdjustment = variant.priceAdjustment;
  }

  // Modifier lookup — batch-load all requested modifiers in one query.
  // Silently skip any that aren't found (matches web POS behaviour).
  // Snapshot the name + price at add-time so a later Modifier price
  // change doesn't retroactively re-price paid orders.
  const requestedIds = modifiersInput.map((m) => m.modifierId);
  const modifierRows = requestedIds.length
    ? await prisma.modifier.findMany({
        where: { id: { in: requestedIds }, isActive: true },
        select: { id: true, name: true, price: true },
      })
    : [];
  const modifierById = new Map(modifierRows.map((m) => [m.id, m]));

  const resolvedModifiers = modifiersInput
    .map((input) => {
      const found = modifierById.get(input.modifierId);
      if (!found) return null;
      const rawModQty = Number(input.quantity ?? 1);
      const modQty = Number.isFinite(rawModQty) ? Math.max(1, Math.floor(rawModQty)) : 1;
      return {
        modifierId: found.id,
        modifierName: found.name,
        price: found.price,
        quantity: modQty,
      };
    })
    .filter(<T,>(x: T | null): x is T => x !== null);

  const modifiersTotal = resolvedModifiers.reduce(
    (sum, m) => sum + m.price * m.quantity,
    0
  );

  const unitPrice = product.basePrice + priceAdjustment;
  const itemTotal = (unitPrice + modifiersTotal) * quantity;

  // Stack ONLY when the new line has no variant AND no modifiers AND no
  // instructions — anything else forces a fresh line.
  const canStack =
    !variantId && resolvedModifiers.length === 0 && !specialInstructions;

  const existing = canStack
    ? await prisma.orderItem.findFirst({
        where: {
          orderId,
          productId,
          variantId: null,
          specialInstructions: null,
          modifiers: { none: {} },
        },
        select: { id: true, quantity: true, unitPrice: true, modifiersTotal: true },
      })
    : null;

  if (existing) {
    const newQty = existing.quantity + quantity;
    await prisma.orderItem.update({
      where: { id: existing.id },
      data: {
        quantity: newQty,
        itemTotal: (existing.unitPrice + (existing.modifiersTotal || 0)) * newQty,
      },
    });
  } else {
    // Create the item + its modifiers atomically. If modifier insert fails
    // we don't want an item hanging around without its selections.
    await prisma.$transaction(async (tx) => {
      const created = await tx.orderItem.create({
        data: {
          orderId,
          productId: product.id,
          productName: product.name,
          variantId,
          variantName,
          quantity,
          unitPrice,
          modifiersTotal,
          itemTotal,
          unitCost: product.costPrice || 0,
          specialInstructions,
          status: "PENDING",
        },
        select: { id: true },
      });

      if (resolvedModifiers.length > 0) {
        await tx.orderItemModifier.createMany({
          data: resolvedModifiers.map((m) => ({
            orderItemId: created.id,
            modifierId: m.modifierId,
            modifierName: m.modifierName,
            price: m.price,
            // NOTE: OrderItemModifier has no `quantity` column in the schema
            // (see prisma/schema.prisma line 1400). Web POS's create includes
            // quantity but it's silently dropped. We match here — the
            // modifiersTotal on OrderItem already reflects the intended
            // per-modifier count so nothing is lost financially.
          })),
        });
      }
    });
  }

  const totals = await recomputeOrderTotals(orderId);
  return NextResponse.json({ ok: true, totals }, { status: 201 });
}
