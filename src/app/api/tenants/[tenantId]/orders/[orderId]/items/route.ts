// POST /api/tenants/[tenantId]/orders/[orderId]/items - Add item to order
// GET /api/tenants/[tenantId]/orders/[orderId]/items - Get order items

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Add item to existing order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const {
      productId,
      variantId,
      quantity = 1,
      modifiers = [],
      specialInstructions,
      allergyNotes = [],
    } = body;

    if (!productId) {
      return NextResponse.json(
        { error: "productId is required" },
        { status: 400 }
      );
    }

    // Get order
    const order = await prisma.order.findFirst({
      where: { id: orderId, location: { tenantId } },
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    // Can only add items to active orders
    const editableStatuses = ["NEW", "CONFIRMED", "PREPARING"];
    if (!editableStatuses.includes(order.status)) {
      return NextResponse.json(
        { error: "Cannot add items to this order" },
        { status: 400 }
      );
    }

    // Get product
    const product = await prisma.product.findFirst({
      where: { id: productId, tenantId, isActive: true },
      include: {
        variants: true,
        productAllergens: { include: { allergen: true } },
        recipes: { include: { ingredient: true } },
      },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    if (!product.isAvailable) {
      return NextResponse.json(
        { error: "Product not available" },
        { status: 400 }
      );
    }

    // Get variant
    let variant = null;
    let variantName = null;
    let priceAdjustment = 0;
    let costAdjustment = 0;

    if (variantId) {
      variant = product.variants.find((v) => v.id === variantId);
      if (!variant) {
        return NextResponse.json(
          { error: "Variant not found" },
          { status: 404 }
        );
      }
      variantName = variant.name;
      priceAdjustment = variant.priceAdjustment;
      costAdjustment = variant.costAdjustment;
    }

    // Calculate modifier prices
    let modifiersTotal = 0;
    let modifiersCost = 0;
    const itemModifiers: any[] = [];

    for (const mod of modifiers) {
      const modifier = await prisma.modifier.findUnique({
        where: { id: mod.modifierId },
      });
      if (modifier) {
        const modQty = mod.quantity || 1;
        modifiersTotal += modifier.price * modQty;
        modifiersCost += modifier.cost * modQty;
        itemModifiers.push({
          modifierId: modifier.id,
          modifierName: modifier.name,
          quantity: modQty,
          price: modifier.price,
        });
      }
    }

    // Calculate totals
    const unitPrice = product.basePrice + priceAdjustment;
    const itemTotal = (unitPrice + modifiersTotal) * quantity;

    let recipeCost = 0;
    for (const recipe of product.recipes) {
      recipeCost += recipe.ingredient.costPerUnit * recipe.quantity;
    }
    const unitCost = product.costPrice + product.labourCost + costAdjustment + modifiersCost + Math.round(recipeCost);

    // Get settings
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    // Create item in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create order item
      const orderItem = await tx.orderItem.create({
        data: {
          orderId,
          productId,
          variantId: variant?.id || null,
          productName: product.name,
          variantName,
          quantity,
          unitPrice,
          modifiersTotal,
          itemTotal,
          unitCost,
          specialInstructions: specialInstructions || null,
          status: "PENDING",
        },
      });

      // Create modifiers
      if (itemModifiers.length > 0) {
        await tx.orderItemModifier.createMany({
          data: itemModifiers.map((m) => ({
            orderItemId: orderItem.id,
            modifierId: m.modifierId,
            modifierName: m.modifierName,
            quantity: m.quantity,
            price: m.price,
          })),
        });
      }

      // Create allergen notes
      const allergenNotesData: any[] = [];

      // Auto-add product allergens
      for (const pa of product.productAllergens) {
        allergenNotesData.push({
          orderItemId: orderItem.id,
          allergenId: pa.allergenId,
          note: `Contains ${pa.allergen.name}`,
          isAllergy: false,
        });
      }

      // Add customer allergy notes
      for (const an of allergyNotes) {
        allergenNotesData.push({
          orderItemId: orderItem.id,
          allergenId: an.allergenId,
          note: an.note || "Customer allergy",
          isAllergy: true,
        });
      }

      if (allergenNotesData.length > 0) {
        await tx.orderItemAllergen.createMany({
          data: allergenNotesData,
        });
      }

      // Add to kitchen queue
      if (settings?.kitchenDisplayEnabled) {
        const stationProduct = await tx.stationProduct.findFirst({
          where: { productId },
        });

        if (stationProduct) {
          await tx.kitchenQueue.create({
            data: {
              orderId,
              orderItemId: orderItem.id,
              stationId: stationProduct.stationId,
              status: "PENDING",
              priority: 0,
            },
          });
        }
      }

      // Update order totals
      const taxRate = settings?.taxEnabled ? Number(settings.taxRate) : 0;
      const tax2Rate = settings?.tax2Enabled ? Number(settings.tax2Rate) : 0;

      const newSubtotal = order.subtotal + itemTotal;
      const newTaxAmount = Math.round((newSubtotal * taxRate) / 100);
      const newTax2Amount = Math.round((newSubtotal * tax2Rate) / 100);
      const newTotal = newSubtotal + newTaxAmount + newTax2Amount - order.discountAmount + order.tipAmount;
      const newTotalCost = order.totalCost + unitCost * quantity;

      await tx.order.update({
        where: { id: orderId },
        data: {
          subtotal: newSubtotal,
          taxAmount: newTaxAmount,
          tax2Amount: newTax2Amount,
          total: newTotal,
          totalCost: newTotalCost,
        },
      });

      // Deduct inventory
      if (settings?.autoDeductInventory && product.trackInventory) {
        for (const recipe of product.recipes) {
          const qty = recipe.quantity * quantity;

          const inv = await tx.locationInventory.findUnique({
            where: {
              locationId_ingredientId: {
                locationId: order.locationId,
                ingredientId: recipe.ingredientId,
              },
            },
          });

          if (inv && inv.currentStock >= qty) {
            await tx.locationInventory.update({
              where: { id: inv.id },
              data: { currentStock: inv.currentStock - qty },
            });

            await tx.stockMovement.create({
              data: {
                locationId: order.locationId,
                ingredientId: recipe.ingredientId,
                type: "SALE",
                quantity: -qty,
                previousStock: inv.currentStock,
                newStock: inv.currentStock - qty,
                orderId,
                createdById: validation.context.membership.id,
              },
            });
          }
        }
      }

      return orderItem;
    });

    // Get complete item
    const completeItem = await prisma.orderItem.findUnique({
      where: { id: result.id },
      include: {
        modifiers: true,
        allergenNotes: { include: { allergen: true } },
      },
    });

    console.log(`[TAP API] Added item to order: ${order.orderNumber}`);

    return NextResponse.json({
      success: true,
      item: completeItem,
    });
  } catch (error: any) {
    console.error("[TAP API] Add order item error:", error);
    return NextResponse.json(
      { error: "Failed to add item" },
      { status: 500 }
    );
  }
}

// GET - Get order items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; orderId: string }> }
) {
  try {
    const { tenantId, orderId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const order = await prisma.order.findFirst({
      where: { id: orderId, location: { tenantId } },
      select: { id: true, orderNumber: true },
    });

    if (!order) {
      return NextResponse.json(
        { error: "Order not found" },
        { status: 404 }
      );
    }

    const items = await prisma.orderItem.findMany({
      where: { orderId },
      include: {
        product: {
          select: { id: true, name: true, imageUrl: true, prepTimeMinutes: true },
        },
        modifiers: true,
        allergenNotes: { include: { allergen: true } },
        kitchenQueue: {
          include: { station: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      success: true,
      orderNumber: order.orderNumber,
      items,
    });
  } catch (error: any) {
    console.error("[TAP API] Get order items error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
