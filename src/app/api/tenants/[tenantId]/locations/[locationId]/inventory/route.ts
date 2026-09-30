// POST /api/tenants/[tenantId]/locations/[locationId]/inventory - Adjust stock
// GET /api/tenants/[tenantId]/locations/[locationId]/inventory - Get location inventory

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Adjust inventory (purchase, adjustment, waste, etc.)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const {
      ingredientId,
      type, // PURCHASE, ADJUSTMENT, WASTE, RETURN
      quantity, // positive for add, negative for remove
      reason,
      unitCost, // for purchases, in cents
    } = body;

    if (!ingredientId || !type || quantity === undefined) {
      return NextResponse.json(
        { error: "ingredientId, type, and quantity are required" },
        { status: 400 }
      );
    }

    const validTypes = ["PURCHASE", "ADJUSTMENT", "WASTE", "RETURN"];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate location belongs to tenant
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
    });

    if (!location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    // Validate ingredient
    const ingredient = await prisma.ingredient.findFirst({
      where: { id: ingredientId, tenantId },
    });

    if (!ingredient) {
      return NextResponse.json(
        { error: "Ingredient not found" },
        { status: 404 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Get or create location inventory
      let inventory = await tx.locationInventory.findUnique({
        where: {
          locationId_ingredientId: { locationId, ingredientId },
        },
      });

      const previousStock = inventory?.currentStock || 0;
      const newStock = previousStock + quantity;

      if (newStock < 0) {
        throw new Error("Cannot reduce stock below zero");
      }

      // Update or create inventory
      if (inventory) {
        inventory = await tx.locationInventory.update({
          where: { id: inventory.id },
          data: {
            currentStock: newStock,
            lastCountedAt: type === "ADJUSTMENT" ? new Date() : undefined,
            lastCountedBy: type === "ADJUSTMENT" ? validation.context.membership.id : undefined,
          },
        });
      } else {
        inventory = await tx.locationInventory.create({
          data: {
            locationId,
            ingredientId,
            currentStock: newStock,
          },
        });
      }

      // Update ingredient cost if this is a purchase with new cost
      if (type === "PURCHASE" && unitCost !== undefined) {
        await tx.ingredient.update({
          where: { id: ingredientId },
          data: { costPerUnit: Math.round(unitCost) },
        });
      }

      // Create stock movement record
      const movement = await tx.stockMovement.create({
        data: {
          locationId,
          ingredientId,
          type: type as any,
          quantity,
          previousStock,
          newStock,
          reason: reason || null,
          createdById: validation.context.membership.id,
        },
        include: {
          ingredient: { select: { name: true, unit: true } },
          location: { select: { name: true } },
        },
      });

      return { inventory, movement };
    });

    console.log(`[TAP API] Stock ${type}: ${ingredient.name} ${quantity > 0 ? "+" : ""}${quantity} at ${location.name}`);

    return NextResponse.json({
      success: true,
      inventory: result.inventory,
      movement: result.movement,
    });
  } catch (error: any) {
    console.error("[TAP API] Adjust inventory error:", error);
    if (error.message === "Cannot reduce stock below zero") {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to adjust inventory" },
      { status: 500 }
    );
  }
}

// GET - Get location inventory
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const lowStockOnly = searchParams.get("lowStockOnly") === "true";
    const search = searchParams.get("search");

    // Validate location
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
    });

    if (!location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    // Get all ingredients with their inventory for this location
    const where: any = { tenantId };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
      ];
    }

    const ingredients = await prisma.ingredient.findMany({
      where,
      include: {
        unit: true,
        locationInventory: {
          where: { locationId },
        },
      },
      orderBy: { name: "asc" },
    });

    // Map to inventory items
    let inventory = ingredients.map((ing) => {
      const locInv = ing.locationInventory[0];
      const currentStock = locInv?.currentStock || 0;
      const isLowStock = ing.lowStockThreshold
        ? currentStock <= ing.lowStockThreshold
        : false;

      return {
        ingredientId: ing.id,
        ingredientName: ing.name,
        sku: ing.sku,
        unit: ing.unit,
        currentStock,
        lowStockThreshold: ing.lowStockThreshold,
        isLowStock,
        costPerUnit: ing.costPerUnit,
        totalValue: currentStock * ing.costPerUnit,
        lastCountedAt: locInv?.lastCountedAt,
      };
    });

    if (lowStockOnly) {
      inventory = inventory.filter((i) => i.isLowStock);
    }

    // Calculate totals
    const totalValue = inventory.reduce((sum, i) => sum + i.totalValue, 0);
    const lowStockCount = inventory.filter((i) => i.isLowStock).length;

    return NextResponse.json({
      success: true,
      location: { id: location.id, name: location.name },
      inventory,
      summary: {
        totalItems: inventory.length,
        totalValue,
        lowStockCount,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get inventory error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
