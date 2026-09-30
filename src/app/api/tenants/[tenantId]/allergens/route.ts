// POST /api/tenants/[tenantId]/allergens - Create custom allergen
// GET /api/tenants/[tenantId]/allergens - List all allergens (global + tenant)

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// Seed global allergens if not exist
async function ensureGlobalAllergens() {
  const globalAllergens = [
    { code: "NUTS", name: "Tree Nuts", icon: "🥜", severity: "HIGH" },
    { code: "PEANUTS", name: "Peanuts", icon: "🥜", severity: "HIGH" },
    { code: "DAIRY", name: "Dairy/Milk", icon: "🥛", severity: "HIGH" },
    { code: "EGGS", name: "Eggs", icon: "🥚", severity: "HIGH" },
    { code: "GLUTEN", name: "Gluten/Wheat", icon: "🌾", severity: "HIGH" },
    { code: "SOY", name: "Soy", icon: "🫘", severity: "MEDIUM" },
    { code: "FISH", name: "Fish", icon: "🐟", severity: "HIGH" },
    { code: "SHELLFISH", name: "Shellfish", icon: "🦐", severity: "HIGH" },
    { code: "SESAME", name: "Sesame", icon: "🌰", severity: "HIGH" },
    { code: "MUSTARD", name: "Mustard", icon: "🌿", severity: "MEDIUM" },
    { code: "CELERY", name: "Celery", icon: "🥬", severity: "MEDIUM" },
    { code: "LUPIN", name: "Lupin", icon: "🌸", severity: "MEDIUM" },
    { code: "MOLLUSCS", name: "Molluscs", icon: "🐚", severity: "HIGH" },
    { code: "SULPHITES", name: "Sulphites", icon: "⚗️", severity: "MEDIUM" },
  ];

  for (const allergen of globalAllergens) {
    await prisma.allergen.upsert({
      where: { code: allergen.code },
      update: {},
      create: {
        code: allergen.code,
        name: allergen.name,
        icon: allergen.icon,
        severity: allergen.severity as any,
        isGlobal: true,
      },
    });
  }
}

// POST - Create custom allergen for tenant
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
    const { code, name, icon, severity = "MEDIUM" } = body;

    if (!code?.trim() || !name?.trim()) {
      return NextResponse.json(
        { error: "Allergen code and name are required" },
        { status: 400 }
      );
    }

    // Check for duplicate code
    const existing = await prisma.allergen.findUnique({
      where: { code: code.toUpperCase() },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Allergen with this code already exists" },
        { status: 409 }
      );
    }

    const allergen = await prisma.allergen.create({
      data: {
        code: code.toUpperCase().trim(),
        name: name.trim(),
        icon: icon || "⚠️",
        severity: severity as any,
        isGlobal: true, // All allergens are global in current schema
      },
    });

    console.log(`[TAP API] Created custom allergen: ${allergen.name}`);

    return NextResponse.json({
      success: true,
      allergen,
    });
  } catch (error: any) {
    console.error("[TAP API] Create allergen error:", error);
    return NextResponse.json(
      { error: "Failed to create allergen" },
      { status: 500 }
    );
  }
}

// GET - List all allergens (global + tenant-specific)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "KITCHEN_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    // Ensure global allergens exist
    await ensureGlobalAllergens();

    const allergens = await prisma.allergen.findMany({
      where: {
        isGlobal: true,
      },
      orderBy: [
        { severity: "desc" },
        { name: "asc" },
      ],
    });

    return NextResponse.json({
      success: true,
      allergens,
    });
  } catch (error: any) {
    console.error("[TAP API] List allergens error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
