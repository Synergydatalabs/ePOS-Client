// GET /api/table/[qrCode]/cart - Get guest's cart
// POST /api/table/[qrCode]/cart - Add item to cart
// PUT /api/table/[qrCode]/cart - Update cart item
// DELETE /api/table/[qrCode]/cart - Remove item from cart

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Helper to validate guest token
async function validateGuest(request: NextRequest, qrCode: string) {
  const guestToken = request.headers.get("x-guest-token");

  if (!guestToken) {
    return { success: false, error: "Guest token required", status: 401 };
  }

  const table = await prisma.table.findUnique({
    where: { qrCode },
    select: { id: true, isActive: true },
  });

  if (!table || !table.isActive) {
    return { success: false, error: "Table not found", status: 404 };
  }

  const guest = await prisma.tableGuest.findUnique({
    where: { guestToken },
    include: {
      session: {
        select: {
          id: true,
          status: true,
          tableId: true,
        },
      },
    },
  });

  if (!guest || guest.session.tableId !== table.id) {
    return { success: false, error: "Invalid guest token", status: 401 };
  }

  if (!["ACTIVE", "ORDERING", "DINING"].includes(guest.session.status)) {
    return { success: false, error: "Session is not accepting orders", status: 400 };
  }

  return { success: true, guest, tableId: table.id };
}

// GET - Get guest's cart
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const { qrCode } = await params;
    const validation = await validateGuest(request, qrCode);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const cartItems = await prisma.guestCartItem.findMany({
      where: { guestId: validation.guest!.id },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            basePrice: true,
            imageUrl: true,
            category: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    // Calculate totals
    const subtotal = cartItems.reduce((sum, item) => {
      const modifiersTotal = item.modifiers
        ? (item.modifiers as any[]).reduce((m, mod) => m + (mod.price * (mod.quantity || 1)), 0)
        : 0;
      return sum + (item.unitPrice + modifiersTotal) * item.quantity;
    }, 0);

    return NextResponse.json({
      success: true,
      cart: {
        items: cartItems,
        itemCount: cartItems.reduce((sum, item) => sum + item.quantity, 0),
        subtotal,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get cart error:", error);
    return NextResponse.json(
      { error: "Failed to get cart" },
      { status: 500 }
    );
  }
}

// POST - Add item to cart
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const { qrCode } = await params;
    const validation = await validateGuest(request, qrCode);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const body = await request.json();
    const { productId, variantId, quantity = 1, modifiers, specialInstructions } = body;

    if (!productId) {
      return NextResponse.json(
        { error: "Product ID is required" },
        { status: 400 }
      );
    }

    // Get product with variant
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: true,
        productModifierGroups: {
          include: {
            modifierGroup: {
              include: { modifiers: true },
            },
          },
        },
      },
    });

    if (!product || !product.isActive || !product.isAvailable) {
      return NextResponse.json(
        { error: "Product not available" },
        { status: 400 }
      );
    }

    // Calculate price
    let unitPrice = product.basePrice;
    if (variantId) {
      const variant = product.variants.find(v => v.id === variantId);
      if (variant) {
        unitPrice += variant.priceAdjustment;
      }
    }

    // Process modifiers and calculate their total
    let processedModifiers: any[] = [];
    if (modifiers && Array.isArray(modifiers)) {
      for (const mod of modifiers) {
        const modGroup = product.productModifierGroups.find(
          g => g.modifierGroup.modifiers.some(m => m.id === mod.modifierId)
        );
        if (modGroup) {
          const modifier = modGroup.modifierGroup.modifiers.find(m => m.id === mod.modifierId);
          if (modifier) {
            processedModifiers.push({
              modifierId: modifier.id,
              name: modifier.name,
              price: modifier.price,
              quantity: mod.quantity || 1,
            });
          }
        }
      }
    }

    const cartItem = await prisma.guestCartItem.create({
      data: {
        guestId: validation.guest!.id,
        productId,
        variantId,
        quantity,
        unitPrice,
        modifiers: processedModifiers,
        specialInstructions,
      },
      include: {
        product: {
          select: { id: true, name: true, imageUrl: true },
        },
      },
    });

    // Update session activity
    await prisma.tableSession.update({
      where: { id: validation.guest!.session.id },
      data: { lastActivityAt: new Date(), status: "ORDERING" },
    });

    console.log(`[TAP API] Added to cart: ${product.name} by guest ${validation.guest!.id}`);

    return NextResponse.json({
      success: true,
      cartItem,
    });
  } catch (error: any) {
    console.error("[TAP API] Add to cart error:", error);
    return NextResponse.json(
      { error: "Failed to add item to cart" },
      { status: 500 }
    );
  }
}

// PUT - Update cart item quantity
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const { qrCode } = await params;
    const validation = await validateGuest(request, qrCode);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const body = await request.json();
    const { cartItemId, quantity } = body;

    if (!cartItemId || quantity === undefined) {
      return NextResponse.json(
        { error: "Cart item ID and quantity are required" },
        { status: 400 }
      );
    }

    // Verify cart item belongs to this guest
    const cartItem = await prisma.guestCartItem.findFirst({
      where: {
        id: cartItemId,
        guestId: validation.guest!.id,
      },
    });

    if (!cartItem) {
      return NextResponse.json(
        { error: "Cart item not found" },
        { status: 404 }
      );
    }

    if (quantity <= 0) {
      // Delete item if quantity is 0 or less
      await prisma.guestCartItem.delete({
        where: { id: cartItemId },
      });

      return NextResponse.json({
        success: true,
        deleted: true,
      });
    }

    const updatedItem = await prisma.guestCartItem.update({
      where: { id: cartItemId },
      data: { quantity },
      include: {
        product: {
          select: { id: true, name: true, imageUrl: true },
        },
      },
    });

    return NextResponse.json({
      success: true,
      cartItem: updatedItem,
    });
  } catch (error: any) {
    console.error("[TAP API] Update cart error:", error);
    return NextResponse.json(
      { error: "Failed to update cart" },
      { status: 500 }
    );
  }
}

// DELETE - Remove item from cart
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ qrCode: string }> }
) {
  try {
    const { qrCode } = await params;
    const validation = await validateGuest(request, qrCode);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: validation.status }
      );
    }

    const { searchParams } = new URL(request.url);
    const cartItemId = searchParams.get("itemId");
    const clearAll = searchParams.get("clearAll") === "true";

    if (clearAll) {
      await prisma.guestCartItem.deleteMany({
        where: { guestId: validation.guest!.id },
      });

      return NextResponse.json({
        success: true,
        message: "Cart cleared",
      });
    }

    if (!cartItemId) {
      return NextResponse.json(
        { error: "Item ID is required" },
        { status: 400 }
      );
    }

    // Verify cart item belongs to this guest
    const cartItem = await prisma.guestCartItem.findFirst({
      where: {
        id: cartItemId,
        guestId: validation.guest!.id,
      },
    });

    if (!cartItem) {
      return NextResponse.json(
        { error: "Cart item not found" },
        { status: 404 }
      );
    }

    await prisma.guestCartItem.delete({
      where: { id: cartItemId },
    });

    return NextResponse.json({
      success: true,
      message: "Item removed from cart",
    });
  } catch (error: any) {
    console.error("[TAP API] Remove from cart error:", error);
    return NextResponse.json(
      { error: "Failed to remove item" },
      { status: 500 }
    );
  }
}
