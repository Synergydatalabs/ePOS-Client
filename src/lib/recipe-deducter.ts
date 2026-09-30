// Auto-deduct ingredient stock when an order is fully paid.
//
// Called from the payment + gift-card-redeem endpoints AFTER an order
// flips to paymentStatus=COMPLETED. Iterates the order's items, joins
// each product's Recipe to its ingredients, decrements
// LocationInventory.currentStock, and writes SALE StockMovement rows
// for the audit trail.
//
// Design principles:
//   - IDEMPOTENT: keyed on orderId. If any SALE StockMovement rows
//     already exist for this order, we short-circuit — safeguards
//     against the same order being finalised twice (partial payments
//     followed by a top-up, retry after a network blip, etc.).
//   - BEST-EFFORT: never throws. Payment must not fail because inventory
//     couldn't be decremented (bad recipe data etc.). Errors are logged
//     with enough detail for a merchant to reconcile manually.
//   - Only products with `trackInventory=true` are processed. Others
//     (e.g. digital gift cards) are skipped.
//   - Per-location: uses the order's locationId to find the right
//     LocationInventory row. Multi-location tenants deduct from the
//     store that made the sale.
//   - Zero-clamped: the current_stock column allows negatives (Decimal
//     with no CHECK constraint) but we don't drive stock below zero
//     ourselves — clamp at 0 and log a WARN so the merchant sees they
//     sold more than they had recorded.

import { PrismaClient, Prisma } from "@prisma/client";
import { evaluateIngredientsForReorder } from "@/lib/marketplace-auto-reorder";

/**
 * Trigger inventory deduction for a fully-paid order.
 * Returns quickly (best-effort). Callers should not await if they don't
 * care about the outcome, but awaiting is safe.
 */
export async function deductInventoryForOrder(
  prisma: PrismaClient,
  orderId: string,
  performedById?: string
): Promise<{ deducted: number; skipped: number; error?: string }> {
  try {
    // Idempotency guard — if we've already written any SALE movements
    // for this order, nothing to do.
    const existing = await prisma.stockMovement.count({
      where: { orderId, type: "SALE" },
    });
    if (existing > 0) {
      return { deducted: 0, skipped: 0 };
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        locationId: true,
        status: true,
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            product: {
              select: {
                id: true,
                name: true,
                trackInventory: true,
                recipes: {
                  select: {
                    ingredientId: true,
                    quantity: true,
                    ingredient: {
                      select: { id: true, name: true, tenantId: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      return { deducted: 0, skipped: 0, error: "order not found" };
    }

    // Aggregate ingredient totals across all items — a menu might use the
    // same ingredient in multiple products (e.g. tomato in salad AND
    // sandwich) so we sum before writing to keep the movement ledger
    // clean (one row per ingredient per order).
    type Draft = { qty: Prisma.Decimal; name: string };
    const drafts = new Map<string, Draft>();

    let skipped = 0;
    for (const item of order.items) {
      if (!item.product.trackInventory) {
        skipped++;
        continue;
      }
      if (item.product.recipes.length === 0) {
        // Trackable product with no recipe — flag as skipped rather than
        // silently deducting nothing. Common on freshly-imported menus.
        skipped++;
        continue;
      }
      for (const r of item.product.recipes) {
        const key = r.ingredientId;
        const line = new Prisma.Decimal(r.quantity).mul(item.quantity);
        const prev = drafts.get(key);
        drafts.set(key, {
          qty: prev ? prev.qty.add(line) : line,
          name: r.ingredient.name,
        });
      }
    }

    if (drafts.size === 0) {
      return { deducted: 0, skipped };
    }

    // Load all relevant LocationInventory rows in one query so the tx
    // stays short. Missing rows are auto-created at zero — better than
    // silently swallowing a sale that had no inventory row set up yet.
    const ingredientIds = Array.from(drafts.keys());
    const invRows = await prisma.locationInventory.findMany({
      where: {
        locationId: order.locationId,
        ingredientId: { in: ingredientIds },
      },
    });
    const invByIngredient = new Map(
      invRows.map((r) => [r.ingredientId, r])
    );

    let deducted = 0;

    // One transaction per ingredient so a broken row (constraint issue,
    // etc.) doesn't roll back the good ones. Sale is already complete —
    // partial deductions are better than none.
    for (const [ingredientId, draft] of drafts) {
      try {
        const inv = invByIngredient.get(ingredientId);
        const prevStock = inv
          ? new Prisma.Decimal(inv.currentStock)
          : new Prisma.Decimal(0);
        // Clamp at zero — never drive stock negative from a sale.
        // Log a warning so admins notice sold-more-than-recorded.
        let newStock = prevStock.sub(draft.qty);
        let actualDeduction = draft.qty;
        if (newStock.isNegative()) {
          console.warn(
            `[recipe-deducter] Ingredient ${ingredientId} (${draft.name}) went ` +
              `negative on order ${orderId}: prev=${prevStock}, wanted=${draft.qty}. ` +
              `Clamping to 0.`
          );
          actualDeduction = prevStock;
          newStock = new Prisma.Decimal(0);
        }

        await prisma.$transaction(async (tx) => {
          await tx.locationInventory.upsert({
            where: {
              locationId_ingredientId: {
                locationId: order.locationId,
                ingredientId,
              },
            },
            update: { currentStock: newStock },
            create: {
              locationId: order.locationId,
              ingredientId,
              currentStock: newStock,
            },
          });
          await tx.stockMovement.create({
            data: {
              locationId: order.locationId,
              ingredientId,
              type: "SALE",
              // StockMovement.quantity is signed — SALE = negative
              quantity: actualDeduction.neg(),
              previousStock: prevStock,
              newStock,
              reason: `Auto-deduct for order ${orderId.slice(0, 8)}`,
              orderId,
              performedById: performedById || null,
            },
          });
        });
        deducted++;
      } catch (err: any) {
        console.error(
          `[recipe-deducter] Failed to deduct ${ingredientId} for order ${orderId}:`,
          err?.message || err
        );
      }
    }

    // Phase D #77: after any decrement, evaluate the touched ingredients
    // for auto-reorder. Fire-and-forget — auto-reorder failures NEVER
    // affect the sale that triggered it. Only fires if at least one row
    // was successfully deducted (avoids wasted queries on no-op orders).
    if (deducted > 0) {
      // Need the tenantId to scope the auto-reorder scan. Any ingredient
      // in this order belongs to the same tenant (Product.tenantId ==
      // Ingredient.tenantId is enforced by menu builders), so we grab the
      // first one we see.
      const firstItemWithRecipes = order.items.find((i) => i.product.recipes.length > 0);
      const tenantId = firstItemWithRecipes?.product.recipes[0]?.ingredient.tenantId;
      if (tenantId) {
        const touchedIds = Array.from(drafts.keys());
        evaluateIngredientsForReorder(tenantId, touchedIds).catch((err) => {
          console.error(
            `[recipe-deducter] Auto-reorder eval failed for order ${orderId}:`,
            err?.message || err
          );
        });
      }
    }

    return { deducted, skipped };
  } catch (error: any) {
    console.error(
      `[recipe-deducter] Fatal error for order ${orderId}:`,
      error?.message || error
    );
    return { deducted: 0, skipped: 0, error: error?.message || "unknown" };
  }
}
