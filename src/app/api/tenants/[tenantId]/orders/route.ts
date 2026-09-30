// POST /api/tenants/[tenantId]/orders - Create order (POS fast entry)
// GET /api/tenants/[tenantId]/orders - List orders

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { format } from "date-fns";
import { resolveTax } from "@/lib/tax-resolver";

// Generate order number based on settings
async function generateOrderNumber(tenantId: string, locationId: string): Promise<{ orderNumber: string; displayNumber: number }> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
  });

  const today = format(new Date(), "yyyyMMdd");

  if (settings?.orderNumberReset === "DAILY") {
    // Reset daily - count today's orders for this location
    const count = await prisma.order.count({
      where: {
        locationId,
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    });
    const displayNumber = count + 1;
    return {
      orderNumber: `ORD-${today}-${String(displayNumber).padStart(4, "0")}`,
      displayNumber,
    };
  } else {
    // Never reset - use continuous numbering
    const lastOrder = await prisma.order.findFirst({
      where: { locationId },
      orderBy: { displayNumber: "desc" },
    });
    const displayNumber = (lastOrder?.displayNumber || 0) + 1;
    return {
      orderNumber: `ORD-${today}-${String(displayNumber).padStart(6, "0")}`,
      displayNumber,
    };
  }
}

// POST - Create order
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const {
      locationId,
      orderType = "TAKEAWAY", // DINE_IN, TAKEAWAY, DELIVERY, APPOINTMENT
      tableId,
      customerName,
      customerPhone,
      customerEmail,
      deliveryAddress,
      deliveryNotes,
      appointmentDate, // "2026-04-11" for APPOINTMENT orders
      appointmentTime, // "14:30" for APPOINTMENT orders
      items, // Array of { productId, variantId?, quantity, modifiers?, specialInstructions?, allergyNotes?, technicianId?, scheduledStart?, scheduledEnd? }
      discountAmount = 0,
      tipAmount = 0,
      paymentMethod,
      notes,
      // Optional discount metadata — kept out of the amounts calc since
      // discountAmount is already the source of truth. Used to increment
      // promotion usage + stamp a machine-readable audit line in notes.
      promotionId,
      discountCode,
      discountReason,
      // Cash discount / dual pricing — POS pre-computes based on chosen
      // method and passes the resulting amounts. Server just stores them.
      surchargeAmount = 0,
    } = body;

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: "Order must have at least one item" },
        { status: 400 }
      );
    }

    // Validate location
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId, status: "ACTIVE" },
    });

    if (!location) {
      return NextResponse.json(
        { error: "Location not found or inactive" },
        { status: 404 }
      );
    }

    // Validate table if dine-in
    if (orderType === "DINE_IN" && tableId) {
      const table = await prisma.table.findFirst({
        where: { id: tableId, locationId },
      });
      if (!table) {
        return NextResponse.json(
          { error: "Table not found" },
          { status: 404 }
        );
      }
    }

    // Get settings for tax calculation
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    // Get tenant for currency
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    // Process items and calculate totals
    let subtotal = 0;
    let totalCost = 0;
    const orderItems: any[] = [];

    for (const item of items) {
      // Get product with price info
      const product = await prisma.product.findFirst({
        where: { id: item.productId, tenantId, isActive: true },
        include: {
          variants: true,
          productAllergens: { include: { allergen: true } },
          recipes: {
            include: { ingredient: true },
          },
        },
      });

      if (!product) {
        return NextResponse.json(
          { error: `Product not found: ${item.productId}` },
          { status: 404 }
        );
      }

      if (!product.isAvailable) {
        return NextResponse.json(
          { error: `Product not available: ${product.name}` },
          { status: 400 }
        );
      }

      // Get variant if specified
      let variant = null;
      let variantName = null;
      let priceAdjustment = 0;
      let costAdjustment = 0;

      if (item.variantId) {
        variant = product.variants.find((v) => v.id === item.variantId);
        if (!variant) {
          return NextResponse.json(
            { error: `Variant not found: ${item.variantId}` },
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

      if (item.modifiers && item.modifiers.length > 0) {
        for (const mod of item.modifiers) {
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
      }

      // Calculate item totals
      const unitPrice = product.basePrice + priceAdjustment;
      const itemTotal = (unitPrice + modifiersTotal) * item.quantity;

      // Calculate cost (manual cost + labour + recipe ingredients)
      let recipeCost = 0;
      for (const recipe of product.recipes) {
        recipeCost += recipe.ingredient.costPerUnit * recipe.quantity;
      }
      const unitCost = product.costPrice + product.labourCost + costAdjustment + modifiersCost + Math.round(recipeCost);

      subtotal += itemTotal;
      totalCost += unitCost * item.quantity;

      // Prepare allergen notes
      const allergenNotes: any[] = [];

      // Auto-add product allergens
      for (const pa of product.productAllergens) {
        allergenNotes.push({
          allergenId: pa.allergenId,
          note: `Contains ${pa.allergen.name}`,
          isAllergy: false,
        });
      }

      // Add customer-specified allergy notes
      if (item.allergyNotes && item.allergyNotes.length > 0) {
        for (const an of item.allergyNotes) {
          allergenNotes.push({
            allergenId: an.allergenId,
            note: an.note || `ALLERGY: ${an.allergenName || "Customer allergy"}`,
            isAllergy: true,
          });
        }
      }

      orderItems.push({
        productId: product.id,
        variantId: variant?.id || null,
        productName: product.name,
        variantName,
        quantity: item.quantity,
        unitPrice,
        modifiersTotal,
        itemTotal,
        unitCost,
        specialInstructions: item.specialInstructions || null,
        status: "PENDING",
        modifiers: itemModifiers,
        allergenNotes,
        // Appointment/salon fields
        technicianId: item.technicianId || null,
        scheduledStart: item.scheduledStart ? new Date(item.scheduledStart) : null,
        scheduledEnd: item.scheduledEnd ? new Date(item.scheduledEnd) : null,
      });
    }

    // ── Calculate taxes (per-line, category + location aware) ────────
    // Primary tax uses TaxCategory / LocationTaxRate when a product has a
    // category assigned. Products without a category fall back to the
    // tenant's flat settings.taxRate. Discount is spread proportionally
    // across taxable lines so we don't over-tax the discounted portion.
    const fallbackRate = settings?.taxEnabled ? Number(settings.taxRate) : 0;
    const resolved = await resolveTax({
      tenantId,
      locationId,
      items: orderItems.map((oi) => ({
        productId: oi.productId,
        quantity: oi.quantity,
        lineSubtotal: oi.itemTotal,
      })),
      discountAmount,
      fallbackRatePercent: fallbackRate,
    });
    const taxAmount = resolved.totalTax;
    // tax2 stays flat — Canadian PST etc. that isn't category-varied.
    const tax2Rate = settings?.tax2Enabled ? Number(settings.tax2Rate) : 0;
    const tax2Amount = Math.round(
      (Math.max(0, subtotal - discountAmount) * tax2Rate) / 100
    );

    // Calculate total. Discount is already inside the taxable base above,
    // so subtract it again here to remove the pre-tax amount from total.
    // surchargeAmount is card-processing fee (SURCHARGE mode) — added
    // after tax so tax isn't charged on the surcharge itself.
    const total =
      subtotal - discountAmount + taxAmount + tax2Amount + tipAmount + Math.max(0, Number(surchargeAmount) || 0);

    // Generate order number
    const { orderNumber, displayNumber } = await generateOrderNumber(tenantId, locationId);

    // Prepend a machine-readable discount audit line to notes so admins
    // can trace how the discount was applied without a separate join.
    // Format: "[DISCOUNT] $12.34 · CODE=SUMMER10 · reason=..."
    const discountAudit =
      discountAmount > 0
        ? `[DISCOUNT] $${(discountAmount / 100).toFixed(2)}` +
          (discountCode ? ` · CODE=${discountCode}` : "") +
          (discountReason ? ` · ${discountReason}` : "")
        : null;
    const combinedNotes = [discountAudit, notes]
      .filter(Boolean)
      .join("\n") || null;

    // Create order with items in transaction
    const order = await prisma.$transaction(async (tx) => {
      const newOrder = await tx.order.create({
        data: {
          locationId,
          createdById: validation.context.membership.id,
          orderNumber,
          displayNumber,
          orderType: orderType as any,
          tableId: tableId || null,
          customerName: customerName || null,
          customerPhone: customerPhone || null,
          customerEmail: customerEmail || null,
          deliveryAddress: deliveryAddress || null,
          deliveryNotes: deliveryNotes || null,
          status: "NEW",
          subtotal,
          taxAmount,
          tax2Amount,
          discountAmount,
          surchargeAmount: Math.max(0, Number(surchargeAmount) || 0),
          tipAmount,
          total,
          totalCost,
          currency: tenant?.currency || "CAD",
          paymentStatus: "PENDING",
          paymentMethod: paymentMethod || null,
          notes: combinedNotes,
          // Appointment fields
          appointmentDate: appointmentDate ? new Date(appointmentDate) : null,
          appointmentTime: appointmentTime || null,
        },
      });

      // Increment promotion usage counter — best-effort, doesn't fail the
      // order if the promotion has since been deleted.
      if (promotionId) {
        try {
          await tx.promotion.update({
            where: { id: promotionId },
            data: { usageCount: { increment: 1 } },
          });
        } catch (err: any) {
          console.warn(
            `[orders] Could not increment promotion ${promotionId}:`,
            err?.message
          );
        }
      }

      // Create order items
      for (const item of orderItems) {
        const orderItem = await tx.orderItem.create({
          data: {
            orderId: newOrder.id,
            productId: item.productId,
            variantId: item.variantId,
            productName: item.productName,
            variantName: item.variantName,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            modifiersTotal: item.modifiersTotal,
            itemTotal: item.itemTotal,
            unitCost: item.unitCost,
            specialInstructions: item.specialInstructions,
            status: item.status,
            // Appointment/salon fields
            technicianId: item.technicianId,
            scheduledStart: item.scheduledStart,
            scheduledEnd: item.scheduledEnd,
          },
        });

        // Create item modifiers
        if (item.modifiers.length > 0) {
          await tx.orderItemModifier.createMany({
            data: item.modifiers.map((m: any) => ({
              orderItemId: orderItem.id,
              modifierId: m.modifierId,
              modifierName: m.modifierName,
              quantity: m.quantity,
              price: m.price,
            })),
          });
        }

        // Create allergen notes
        if (item.allergenNotes.length > 0) {
          await tx.orderItemAllergen.createMany({
            data: item.allergenNotes.map((an: any) => ({
              orderItemId: orderItem.id,
              allergenId: an.allergenId,
              note: an.note,
              isAllergy: an.isAllergy,
            })),
          });
        }

        // Add to kitchen queue if kitchen display enabled (skip for appointments)
        if (settings?.kitchenDisplayEnabled && orderType !== "APPOINTMENT") {
          // 1. Look up explicit station mapping for this product at this location
          let stationId: string | null = null;
          const stationProduct = await tx.stationProduct.findFirst({
            where: {
              productId: item.productId,
              station: { locationId },
            },
          });

          if (stationProduct) {
            stationId = stationProduct.stationId;
          } else {
            // 2. Fallback: use the first active station at this location so the item
            //    never gets silently lost (admin can reassign later)
            const fallback = await tx.kitchenStation.findFirst({
              where: { locationId, isActive: true },
              orderBy: { displayOrder: "asc" },
              select: { id: true },
            });
            if (fallback) {
              stationId = fallback.id;
            }
          }

          // Always create the queue row — stationId is nullable in the
          // schema and the display groups un-stationed items into a
          // default column. The previous `if (stationId)` gate silently
          // dropped items for tenants with no stations configured
          // (Andy's Pizza demo hit this), so "Kitchen Display shows
          // nothing" was actually "no rows ever written".
          await tx.kitchenQueue.create({
            data: {
              orderId: newOrder.id,
              orderItemId: orderItem.id,
              stationId, // may be null — that's fine per schema
              status: "PENDING",
              priority: 0,
            },
          });
        }
      }

      // Update table status if dine-in
      if (orderType === "DINE_IN" && tableId) {
        await tx.table.update({
          where: { id: tableId },
          data: { status: "OCCUPIED" },
        });
      }

      // Deduct inventory if enabled
      if (settings?.autoDeductInventory) {
        for (const item of orderItems) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            include: { recipes: true },
          });

          if (product?.trackInventory) {
            for (const recipe of product.recipes) {
              const qty = recipe.quantity * item.quantity;

              // Get location inventory
              const inv = await tx.locationInventory.findUnique({
                where: {
                  locationId_ingredientId: {
                    locationId,
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
                    locationId,
                    ingredientId: recipe.ingredientId,
                    type: "SALE",
                    quantity: -qty,
                    previousStock: inv.currentStock,
                    newStock: inv.currentStock - qty,
                    orderId: newOrder.id,
                    createdById: validation.context.membership.id,
                  },
                });
              }
            }
          }
        }
      }

      return newOrder;
    });

    // Fetch complete order
    const completeOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        items: {
          include: {
            modifiers: true,
            allergenNotes: { include: { allergen: true } },
            technician: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        table: true,
        location: { select: { id: true, name: true } },
      },
    });

    console.log(`[TAP API] Created order: ${orderNumber} for tenant: ${tenantId}`);

    return NextResponse.json({
      success: true,
      order: completeOrder,
    });
  } catch (error: any) {
    console.error("[TAP API] Create order error:", error);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}

// GET - List orders
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");
    const status = searchParams.get("status");
    const orderType = searchParams.get("orderType");
    const tableId = searchParams.get("tableId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const appointmentDate = searchParams.get("appointmentDate");
    // Phase 8 QA: week-view support — inclusive range on
    // Order.appointmentDate. If both are set, they win over the single
    // date param.
    const appointmentDateFrom = searchParams.get("appointmentDateFrom");
    const appointmentDateTo = searchParams.get("appointmentDateTo");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");

    // Filter orders through the location's tenantId since Order doesn't have tenantId directly
    const where: any = { location: { tenantId } };

    if (locationId) where.locationId = locationId;
    if (status) where.status = status;
    if (orderType) where.orderType = orderType;
    if (tableId) where.tableId = tableId;
    if (appointmentDateFrom || appointmentDateTo) {
      where.appointmentDate = {};
      if (appointmentDateFrom)
        where.appointmentDate.gte = new Date(appointmentDateFrom);
      if (appointmentDateTo)
        where.appointmentDate.lte = new Date(appointmentDateTo);
    } else if (appointmentDate) {
      where.appointmentDate = new Date(appointmentDate);
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          items: {
            include: {
              modifiers: true,
              allergenNotes: { include: { allergen: true } },
              technician: { select: { id: true, firstName: true, lastName: true } },
            },
          },
          table: { select: { id: true, tableNumber: true, name: true } },
          location: { select: { id: true, name: true } },
          createdBy: { select: { firstName: true, lastName: true } },
          // Only completed payments — pending/failed rows would inflate
          // the balance. The appointments list uses this to render
          // "deposit paid / balance due" without a second round-trip.
          payments: {
            where: { status: "COMPLETED" },
            select: { amount: true, method: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.order.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      orders,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + orders.length < total,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] List orders error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
