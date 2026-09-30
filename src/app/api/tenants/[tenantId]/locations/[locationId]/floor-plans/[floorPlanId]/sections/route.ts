// ============================================================================
// /api/.../floor-plans/[floorPlanId]/sections
//
//   GET    → list sections in this floor plan
//   POST   → create a new section
//   DELETE → bulk delete (body: { ids: string[] })
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be hex like #3B82F6")
    .optional()
    .default("#3B82F6"),
  displayOrder: z.number().int().optional(),
  revenueCenter: z.string().max(50).optional(),
  minPartySize: z.number().int().min(1).optional(),
  maxPartySize: z.number().int().min(1).optional(),
  isBookable: z.boolean().optional().default(true),
  description: z.string().max(500).optional(),
});

async function verifyPlanAccess(
  tenantId: string,
  locationId: string,
  floorPlanId: string
) {
  return prisma.floorPlan.findFirst({
    where: { id: floorPlanId, locationId, location: { tenantId } },
    select: { id: true },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; floorPlanId: string }> }
) {
  try {
    const { tenantId, locationId, floorPlanId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_MANAGER");
    if (!auth.success) return auth.response;

    const plan = await verifyPlanAccess(tenantId, locationId, floorPlanId);
    if (!plan) return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });

    const sections = await prisma.section.findMany({
      where: { floorPlanId },
      orderBy: { displayOrder: "asc" },
    });

    return NextResponse.json({ sections });
  } catch (err: any) {
    console.error("[sections GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load sections" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; floorPlanId: string }> }
) {
  try {
    const { tenantId, locationId, floorPlanId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const plan = await verifyPlanAccess(tenantId, locationId, floorPlanId);
    if (!plan) return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }
    const input = parsed.data;

    // Auto displayOrder: append
    let displayOrder = input.displayOrder;
    if (displayOrder === undefined) {
      const maxOrder = await prisma.section.aggregate({
        where: { floorPlanId },
        _max: { displayOrder: true },
      });
      displayOrder = (maxOrder._max.displayOrder ?? 0) + 1;
    }

    const section = await prisma.section.create({
      data: {
        floorPlanId,
        name: input.name.trim(),
        color: input.color,
        displayOrder,
        revenueCenter: input.revenueCenter ?? null,
        minPartySize: input.minPartySize ?? null,
        maxPartySize: input.maxPartySize ?? null,
        isBookable: input.isBookable,
        description: input.description ?? null,
      },
    });

    return NextResponse.json({ section }, { status: 201 });
  } catch (err: any) {
    console.error("[sections POST] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to create section" },
      { status: 500 }
    );
  }
}

const deleteSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
});

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string; floorPlanId: string }> }
) {
  try {
    const { tenantId, locationId, floorPlanId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const plan = await verifyPlanAccess(tenantId, locationId, floorPlanId);
    if (!plan) return NextResponse.json({ error: "Floor plan not found" }, { status: 404 });

    const body = await request.json();
    const parsed = deleteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.format() },
        { status: 400 }
      );
    }

    // Tables in these sections get sectionId = null (don't delete the tables)
    await prisma.$transaction([
      prisma.table.updateMany({
        where: { sectionId: { in: parsed.data.ids } },
        data: { sectionId: null },
      }),
      prisma.section.deleteMany({
        where: { id: { in: parsed.data.ids }, floorPlanId },
      }),
    ]);

    return NextResponse.json({ success: true, deleted: parsed.data.ids.length });
  } catch (err: any) {
    console.error("[sections DELETE] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to delete sections" },
      { status: 500 }
    );
  }
}
