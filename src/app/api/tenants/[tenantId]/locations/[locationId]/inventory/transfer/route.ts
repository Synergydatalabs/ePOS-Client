// POST /api/tenants/[tenantId]/locations/[locationId]/inventory/transfer - Transfer stock between locations

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// POST - Transfer stock to another location
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId: fromLocationId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const {
      toLocationId,
      ingredientId,
      quantity,
      reason,
    } = body;

    if (!toLocationId || !ingredientId || !quantity || quantity <= 0) {
      return NextResponse.json(
        { error: "toLocationId, ingredientId, and positive quantity are required" },
        { status: 400 }
      );
    }

    if (fromLocationId === toLocationId) {
      return NextResponse.json(
        { error: "Cannot transfer to the same location" },
        { status: 400 }
      );
    }

    // Validate locations
    const [fromLocation, toLocation] = await Promise.all([
      prisma.location.findFirst({ where: { id: fromLocationId, tenantId } }),
      prisma.location.findFirst({ where: { id: toLocationId, tenantId } }),
    ]);

    if (!fromLocation) {
      return NextResponse.json(
        { error: "Source location not found" },
        { status: 404 }
      );
    }

    if (!toLocation) {
      return NextResponse.json(
        { error: "Destination location not found" },
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
      // Get source inventory
      const fromInventory = await tx.locationInventory.findUnique({
        where: {
          locationId_ingredientId: { locationId: fromLocationId, ingredientId },
        },
      });

      const fromStock = fromInventory?.currentStock || 0;
      if (fromStock < quantity) {
        throw new Error(`Insufficient stock. Available: ${fromStock}, Requested: ${quantity}`);
      }

      // Get or create destination inventory
      let toInventory = await tx.locationInventory.findUnique({
        where: {
          locationId_ingredientId: { locationId: toLocationId, ingredientId },
        },
      });

      const toStock = toInventory?.currentStock || 0;

      // Update source inventory
      await tx.locationInventory.update({
        where: { id: fromInventory!.id },
        data: { currentStock: fromStock - quantity },
      });

      // Update or create destination inventory
      if (toInventory) {
        await tx.locationInventory.update({
          where: { id: toInventory.id },
          data: { currentStock: toStock + quantity },
        });
      } else {
        toInventory = await tx.locationInventory.create({
          data: {
            locationId: toLocationId,
            ingredientId,
            currentStock: quantity,
          },
        });
      }

      const transferReason = reason || `Transfer to ${toLocation.name}`;

      // Create stock movement for source (TRANSFER_OUT)
      const fromMovement = await tx.stockMovement.create({
        data: {
          locationId: fromLocationId,
          ingredientId,
          type: "TRANSFER_OUT",
          quantity: -quantity,
          previousStock: fromStock,
          newStock: fromStock - quantity,
          reason: transferReason,
          createdById: validation.context.membership.id,
        },
      });

      // Create stock movement for destination (TRANSFER_IN)
      const toMovement = await tx.stockMovement.create({
        data: {
          locationId: toLocationId,
          ingredientId,
          type: "TRANSFER_IN",
          quantity: quantity,
          previousStock: toStock,
          newStock: toStock + quantity,
          reason: `Transfer from ${fromLocation.name}`,
          createdById: validation.context.membership.id,
        },
      });

      return {
        fromMovement,
        toMovement,
        fromStock: fromStock - quantity,
        toStock: toStock + quantity,
      };
    });

    console.log(
      `[TAP API] Stock transfer: ${ingredient.name} x${quantity} from ${fromLocation.name} to ${toLocation.name}`
    );

    return NextResponse.json({
      success: true,
      transfer: {
        ingredientId,
        ingredientName: ingredient.name,
        quantity,
        fromLocation: {
          id: fromLocation.id,
          name: fromLocation.name,
          newStock: result.fromStock,
        },
        toLocation: {
          id: toLocation.id,
          name: toLocation.name,
          newStock: result.toStock,
        },
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Transfer inventory error:", error);
    if (error.message?.includes("Insufficient stock")) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to transfer inventory" },
      { status: 500 }
    );
  }
}
