// Auto-add stock to the merchant's inventory when a purchase order lands in
// DELIVERED. Called from BOTH transition endpoints (merchant confirm-receipt
// and supplier hand-delivery mark-delivered) so both paths behave identically.
//
// Matching rule (v1, safe/predictable):
//   For each PO line item with a productSku:
//     find Ingredient where tenantId = merchant AND supplierSku ILIKE productSku
//   Case-insensitive match. Ties (rare, and a merchant-side data issue)
//   resolve to the first row — we log a warning but do not fail the sync.
//
// Non-matches are SKIPPED — nothing is auto-created. Merchants keep full
// control over their ingredient list. The API surfaces the skipped list to
// the client so the UI can nudge the merchant to link them up.
//
// Runs inside the caller's transaction so status change + stock increment +
// audit rows all commit or roll back together.

import { Prisma } from "@prisma/client";

// Prisma Decimal is used across inventory. We accept plain numbers for the
// PO qty (which is a plain Int) but write Decimals to StockMovement /
// LocationInventory to match their schema types.

export interface SyncPoItem {
  id: string;              // PurchaseOrderItem.id
  productSku: string | null;
  productName: string;
  qty: number;
}

export interface SyncPoContext {
  id: string;              // PurchaseOrder.id
  poNumber: string;
  merchantTenantId: string;
  merchantLocationId: string;
  items: SyncPoItem[];
}

export interface SyncedItem {
  lineItemId: string;
  ingredientId: string;
  ingredientName: string;
  qtyAdded: number;
  newStock: number;
}

export interface SkippedItem {
  lineItemId: string;
  productName: string;
  productSku: string | null;
  reason: string;
}

export interface SyncResult {
  syncedItems: SyncedItem[];
  skippedItems: SkippedItem[];
}

export async function syncPurchaseOrderInventory(
  tx: Prisma.TransactionClient,
  order: SyncPoContext,
  performedByMembershipId: string | null
): Promise<SyncResult> {
  const syncedItems: SyncedItem[] = [];
  const skippedItems: SkippedItem[] = [];

  // Collect all SKUs from the PO in one lookup rather than one-per-line.
  // Case-insensitive because Postgres text comparisons are, and merchant
  // SKU capitalization habits vary wildly.
  const skus = order.items
    .map((i) => i.productSku)
    .filter((s): s is string => !!s && s.trim().length > 0);

  // ingredientsBySku: Map<lowercase sku, Ingredient>. When multiple
  // ingredients share a supplierSku (data-quality issue on the merchant
  // side), the first row wins and we log a warning. A "proper" fix would
  // be a UNIQUE(supplierSku) index — but that's a merchant-side data
  // migration and outside Phase B scope.
  const ingredientsBySku = new Map<
    string,
    { id: string; name: string; supplierSku: string }
  >();

  if (skus.length > 0) {
    const found = await tx.ingredient.findMany({
      where: {
        tenantId: order.merchantTenantId,
        isActive: true,
        supplierSku: { in: skus, mode: "insensitive" },
      },
      select: { id: true, name: true, supplierSku: true },
    });
    for (const ing of found) {
      const key = (ing.supplierSku || "").toLowerCase();
      if (ingredientsBySku.has(key)) {
        console.warn(
          `[PO-SYNC] Duplicate supplierSku="${ing.supplierSku}" on tenant ${order.merchantTenantId} — using first match (${ingredientsBySku.get(key)!.id}), ignoring ${ing.id}`
        );
        continue;
      }
      ingredientsBySku.set(key, {
        id: ing.id,
        name: ing.name,
        supplierSku: ing.supplierSku!,
      });
    }
  }

  for (const item of order.items) {
    // No SKU on the PO line → can't link. Skipped cleanly.
    if (!item.productSku) {
      skippedItems.push({
        lineItemId: item.id,
        productName: item.productName,
        productSku: null,
        reason: "No SKU on this item — link manually in Inventory.",
      });
      continue;
    }

    const match = ingredientsBySku.get(item.productSku.toLowerCase());
    if (!match) {
      skippedItems.push({
        lineItemId: item.id,
        productName: item.productName,
        productSku: item.productSku,
        reason: `No Ingredient in your inventory with supplier SKU "${item.productSku}". Add it in Inventory → Ingredients, or set the supplier SKU on an existing ingredient.`,
      });
      continue;
    }

    // Upsert location inventory + write the stock movement in one row-per-
    // ingredient pass. We do this line-by-line inside the transaction so
    // an unexpected error on one line rolls the whole sync back — the PO
    // state change rolls back with it (both live in the same tx).
    const existingInv = await tx.locationInventory.findUnique({
      where: {
        locationId_ingredientId: {
          locationId: order.merchantLocationId,
          ingredientId: match.id,
        },
      },
    });

    const previousStock = existingInv?.currentStock
      ? Number(existingInv.currentStock)
      : 0;
    const newStock = previousStock + item.qty;

    if (existingInv) {
      await tx.locationInventory.update({
        where: { id: existingInv.id },
        data: {
          currentStock: new Prisma.Decimal(newStock),
        },
      });
    } else {
      await tx.locationInventory.create({
        data: {
          locationId: order.merchantLocationId,
          ingredientId: match.id,
          currentStock: new Prisma.Decimal(newStock),
        },
      });
    }

    await tx.stockMovement.create({
      data: {
        locationId: order.merchantLocationId,
        ingredientId: match.id,
        type: "PURCHASE",
        quantity: new Prisma.Decimal(item.qty),
        previousStock: new Prisma.Decimal(previousStock),
        newStock: new Prisma.Decimal(newStock),
        reason: `Delivered on PO ${order.poNumber}`,
        performedById: performedByMembershipId,
      },
    });

    syncedItems.push({
      lineItemId: item.id,
      ingredientId: match.id,
      ingredientName: match.name,
      qtyAdded: item.qty,
      newStock,
    });
  }

  console.log(
    `[PO-SYNC] ${order.poNumber}: synced ${syncedItems.length}, skipped ${skippedItems.length} (location ${order.merchantLocationId})`
  );

  return { syncedItems, skippedItems };
}
