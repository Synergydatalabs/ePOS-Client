// POST /api/tenants/[tenantId]/units - Create unit of measure
// GET /api/tenants/[tenantId]/units - List units of measure

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// Seed default units for a tenant if they don't already exist.
// (Schema requires tenantId — so units are per-tenant, not truly global.)
async function ensureDefaultUnits(tenantId: string) {
  const defaultUnits = [
    // Weight
    { name: "Kilogram",   symbol: "kg",   type: "WEIGHT", baseUnit: "g",  conversionFactor: 1000 },
    { name: "Gram",       symbol: "g",    type: "WEIGHT", baseUnit: "g",  conversionFactor: 1 },
    { name: "Pound",      symbol: "lb",   type: "WEIGHT", baseUnit: "g",  conversionFactor: 453.592 },
    { name: "Ounce",      symbol: "oz",   type: "WEIGHT", baseUnit: "g",  conversionFactor: 28.3495 },
    // Volume
    { name: "Liter",      symbol: "L",    type: "VOLUME", baseUnit: "ml", conversionFactor: 1000 },
    { name: "Milliliter", symbol: "ml",   type: "VOLUME", baseUnit: "ml", conversionFactor: 1 },
    { name: "Gallon",     symbol: "gal",  type: "VOLUME", baseUnit: "ml", conversionFactor: 3785.41 },
    { name: "Cup",        symbol: "cup",  type: "VOLUME", baseUnit: "ml", conversionFactor: 236.588 },
    { name: "Tablespoon", symbol: "tbsp", type: "VOLUME", baseUnit: "ml", conversionFactor: 14.7868 },
    { name: "Teaspoon",   symbol: "tsp",  type: "VOLUME", baseUnit: "ml", conversionFactor: 4.92892 },
    // Count
    { name: "Piece",      symbol: "pc",   type: "COUNT",  baseUnit: "pc", conversionFactor: 1 },
    { name: "Dozen",      symbol: "dz",   type: "COUNT",  baseUnit: "pc", conversionFactor: 12 },
    { name: "Case",       symbol: "case", type: "COUNT",  baseUnit: "pc", conversionFactor: 1 },
    { name: "Box",        symbol: "box",  type: "COUNT",  baseUnit: "pc", conversionFactor: 1 },
    { name: "Bag",        symbol: "bag",  type: "COUNT",  baseUnit: "pc", conversionFactor: 1 },
  ];

  // Check what symbols this tenant already has (avoid redundant creates)
  const existing = await prisma.unitOfMeasure.findMany({
    where: { tenantId },
    select: { symbol: true },
  });
  const existingSymbols = new Set(existing.map((u) => u.symbol));

  const toCreate = defaultUnits.filter((u) => !existingSymbols.has(u.symbol));
  if (toCreate.length === 0) return;

  await prisma.unitOfMeasure.createMany({
    data: toCreate.map((u) => ({
      tenantId,
      name: u.name,
      symbol: u.symbol,
      type: u.type as any,
      baseUnit: u.baseUnit,
      conversionFactor: u.conversionFactor,
    })),
    skipDuplicates: true,
  });
}

// POST - Create custom unit for tenant
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { name, symbol, type, baseUnit, conversionFactor = 1 } = body;

    if (!name?.trim() || !symbol?.trim() || !type) {
      return NextResponse.json(
        { error: "Name, symbol, and type are required" },
        { status: 400 }
      );
    }

    // Check for duplicate symbol within this tenant
    const existing = await prisma.unitOfMeasure.findFirst({
      where: {
        tenantId,
        symbol: symbol.trim(),
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Unit with this symbol already exists" },
        { status: 409 }
      );
    }

    const unit = await prisma.unitOfMeasure.create({
      data: {
        tenantId,
        name: name.trim(),
        symbol: symbol.trim(),
        type: type as any,
        baseUnit: baseUnit?.trim() || symbol.trim(),
        conversionFactor,
      },
    });

    console.log(`[TAP API] Created custom unit: ${unit.name}`);

    return NextResponse.json({
      success: true,
      unit,
    });
  } catch (error: any) {
    console.error("[TAP API] Create unit error:", error);
    return NextResponse.json(
      { error: "Failed to create unit" },
      { status: 500 }
    );
  }
}

// GET - List units (global + tenant-specific)
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

    // Ensure default units exist for this tenant (idempotent)
    await ensureDefaultUnits(tenantId);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    const where: any = { tenantId };

    if (type) {
      where.type = type;
    }

    const units = await prisma.unitOfMeasure.findMany({
      where,
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });

    // Group by type for easier UI display
    const grouped = {
      WEIGHT: units.filter((u) => u.type === "WEIGHT"),
      VOLUME: units.filter((u) => u.type === "VOLUME"),
      COUNT: units.filter((u) => u.type === "COUNT"),
    };

    return NextResponse.json({
      success: true,
      units,
      grouped,
    });
  } catch (error: any) {
    console.error("[TAP API] List units error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
