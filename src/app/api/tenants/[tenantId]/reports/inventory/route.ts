// GET /api/tenants/[tenantId]/reports/inventory - Get inventory report

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const locationId = searchParams.get("locationId");

    // Get all ingredients with inventory across locations
    const ingredients = await prisma.ingredient.findMany({
      where: { tenantId },
      include: {
        unit: true,
        supplier: { select: { id: true, name: true } },
        locationInventory: {
          where: locationId ? { locationId } : undefined,
          include: {
            location: { select: { id: true, name: true } },
          },
        },
        _count: { select: { recipes: true } },
      },
      orderBy: { name: "asc" },
    });

    // Process inventory data
    const inventoryItems = ingredients.map((ing) => {
      const totalStock = ing.locationInventory.reduce(
        (sum, inv) => sum + Number(inv.currentStock),
        0
      );
      const totalValue = totalStock * ing.costPerUnit;
      const threshold = Number(ing.lowStockThreshold) || 0;
      const isLowStock = threshold > 0 ? totalStock <= threshold : false;

      return {
        ingredientId: ing.id,
        ingredientName: ing.name,
        sku: ing.sku,
        unit: ing.unit,
        costPerUnit: ing.costPerUnit,
        totalStock,
        totalValue,
        lowStockThreshold: ing.lowStockThreshold,
        isLowStock,
        usedInRecipes: ing._count.recipes,
        supplier: ing.supplier,
        locationBreakdown: ing.locationInventory.map((inv) => ({
          locationId: inv.locationId,
          locationName: inv.location.name,
          stock: Number(inv.currentStock),
          value: Number(inv.currentStock) * ing.costPerUnit,
          lastCounted: inv.lastCountedAt,
        })),
      };
    });

    // Calculate summaries
    const totalInventoryValue = inventoryItems.reduce(
      (sum, item) => sum + item.totalValue,
      0
    );
    const lowStockItems = inventoryItems.filter((item) => item.isLowStock);
    const outOfStockItems = inventoryItems.filter((item) => item.totalStock === 0);

    // Group by supplier
    const bySupplier: Record<string, {
      supplierId: string | null;
      supplierName: string;
      itemCount: number;
      totalValue: number;
    }> = {};

    for (const item of inventoryItems) {
      const key = item.supplier?.id || "no-supplier";
      if (!bySupplier[key]) {
        bySupplier[key] = {
          supplierId: item.supplier?.id || null,
          supplierName: item.supplier?.name || "No Supplier",
          itemCount: 0,
          totalValue: 0,
        };
      }
      bySupplier[key].itemCount++;
      bySupplier[key].totalValue += item.totalValue;
    }

    // Get recent stock movements
    const recentMovements = await prisma.stockMovement.findMany({
      where: {
        ingredient: { tenantId },
        ...(locationId ? { locationId } : {}),
      },
      include: {
        ingredient: { select: { name: true, unit: { select: { symbol: true } } } },
        location: { select: { name: true } },
        performedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Build stock alerts with status
    const stockAlerts = [
      ...outOfStockItems.map((item) => ({
        ingredientId: item.ingredientId,
        ingredientName: item.ingredientName,
        currentStock: item.totalStock,
        threshold: item.lowStockThreshold || 0,
        unit: item.unit?.symbol || "",
        status: "out" as const,
      })),
      ...lowStockItems
        .filter((item) => item.totalStock > 0) // Don't duplicate out of stock items
        .map((item) => ({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          currentStock: item.totalStock,
          threshold: item.lowStockThreshold || 0,
          unit: item.unit?.symbol || "",
          status: "low" as const,
        })),
    ];

    // Calculate top used ingredients (from SALE movements in recent period)
    const usageByIngredient: Record<string, {
      ingredientId: string;
      ingredientName: string;
      totalUsed: number;
      unit: string;
    }> = {};

    for (const movement of recentMovements) {
      if (movement.type === "SALE" && Number(movement.quantity) > 0) {
        const key = movement.ingredientId;
        if (!usageByIngredient[key]) {
          usageByIngredient[key] = {
            ingredientId: movement.ingredientId,
            ingredientName: movement.ingredient.name,
            totalUsed: 0,
            unit: movement.ingredient.unit?.symbol || "",
          };
        }
        usageByIngredient[key].totalUsed += Number(movement.quantity);
      }
    }

    const topUsed = Object.values(usageByIngredient)
      .sort((a, b) => b.totalUsed - a.totalUsed)
      .slice(0, 10);

    return NextResponse.json({
      success: true,
      report: {
        summary: {
          totalItems: inventoryItems.length,
          totalValue: totalInventoryValue,
          lowStockCount: lowStockItems.length,
          outOfStockCount: outOfStockItems.length,
          // Frontend expects these names
          lowStockItems: lowStockItems.length,
          outOfStockItems: outOfStockItems.length,
        },
        inventoryItems,
        stockAlerts, // Frontend expects this
        lowStockItems: lowStockItems.map((item) => ({
          ingredientId: item.ingredientId,
          ingredientName: item.ingredientName,
          currentStock: item.totalStock,
          threshold: item.lowStockThreshold,
          unit: item.unit?.symbol,
          supplier: item.supplier?.name,
        })),
        bySupplier: Object.values(bySupplier).sort(
          (a, b) => b.totalValue - a.totalValue
        ),
        recentMovements: recentMovements.map((m) => ({
          id: m.id,
          ingredientName: m.ingredient.name,
          locationName: m.location.name,
          type: m.type,
          quantity: Number(m.quantity),
          unit: m.ingredient.unit?.symbol || "",
          previousStock: Number(m.previousStock),
          newStock: Number(m.newStock),
          reason: m.reason,
          notes: m.reason, // Frontend expects notes
          createdBy: m.performedBy
            ? `${m.performedBy.firstName || ""} ${m.performedBy.lastName || ""}`.trim()
            : "System",
          createdAt: m.createdAt,
        })),
        topUsed, // Frontend expects this
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Inventory report error:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}
