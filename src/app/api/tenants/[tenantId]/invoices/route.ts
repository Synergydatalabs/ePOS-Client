// POST /api/tenants/[tenantId]/invoices - Create invoice
// GET /api/tenants/[tenantId]/invoices - List invoices

import { NextRequest, NextResponse } from "next/server";
import { validateRequest, generateIdempotencyKey } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { format } from "date-fns";

// Generate invoice number: INV-YYYYMMDD-XXXX
async function generateInvoiceNumber(tenantId: string): Promise<string> {
  const today = format(new Date(), "yyyyMMdd");
  const prefix = `INV-${today}`;

  // Count today's invoices for this tenant
  const count = await prisma.invoice.count({
    where: {
      tenantId,
      invoiceNumber: {
        startsWith: prefix,
      },
    },
  });

  const sequence = String(count + 1).padStart(4, "0");
  return `${prefix}-${sequence}`;
}

// POST - Create invoice
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    // Validate request - any staff can create invoices
    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const {
      locationId,
      items,
      subtotal: directSubtotal,
      orderReference,
      notes,
      offlineId,
    } = body;

    // Check for offline duplicate
    if (offlineId) {
      const existing = await prisma.invoice.findUnique({
        where: { offlineId },
      });
      if (existing) {
        return NextResponse.json({
          success: true,
          invoice: existing,
          message: "Invoice already synced",
        });
      }
    }

    // Validate location
    const location = await prisma.location.findFirst({
      where: {
        id: locationId,
        tenantId,
        status: "ACTIVE",
      },
    });

    if (!location) {
      // Try default location
      const defaultLocation = await prisma.location.findFirst({
        where: {
          tenantId,
          isDefault: true,
          status: "ACTIVE",
        },
      });

      if (!defaultLocation) {
        return NextResponse.json(
          { error: "No active location found" },
          { status: 400 }
        );
      }
    }

    const finalLocationId = location?.id || (await prisma.location.findFirst({
      where: { tenantId, isDefault: true },
    }))?.id;

    if (!finalLocationId) {
      return NextResponse.json(
        { error: "Location required" },
        { status: 400 }
      );
    }

    // Get tenant settings for tax calculation
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    const taxRate = settings?.taxEnabled ? Number(settings.taxRate) : 0;

    // Calculate totals
    let subtotal = 0;

    if (items && items.length > 0) {
      subtotal = items.reduce(
        (sum: number, item: any) => sum + item.quantity * item.unitPrice,
        0
      );
    } else if (directSubtotal !== undefined) {
      subtotal = Math.round(directSubtotal); // Ensure integer (cents)
    } else {
      return NextResponse.json(
        { error: "Either items or subtotal is required" },
        { status: 400 }
      );
    }

    const taxAmount = Math.round((subtotal * taxRate) / 100);
    const total = subtotal + taxAmount; // Tip added later

    // Generate invoice number
    const invoiceNumber = await generateInvoiceNumber(tenantId);

    // Get tenant currency
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true },
    });

    // Create invoice
    const invoice = await prisma.invoice.create({
      data: {
        tenantId,
        locationId: finalLocationId,
        createdById: validation.context.membership.id,
        invoiceNumber,
        status: "OPEN",
        subtotal,
        taxAmount,
        tipAmount: 0,
        total,
        currency: tenant?.currency || "CAD",
        orderReference: orderReference || null,
        notes: notes || null,
        offlineId: offlineId || null,
        syncedAt: offlineId ? new Date() : null,
      },
    });

    // Create invoice items if provided
    if (items && items.length > 0) {
      await prisma.invoiceItem.createMany({
        data: items.map((item: any) => ({
          invoiceId: invoice.id,
          name: item.name,
          description: item.description || null,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          total: item.quantity * item.unitPrice,
        })),
      });
    }

    // Fetch complete invoice with items
    const completeInvoice = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      include: {
        items: true,
        location: {
          select: { id: true, name: true },
        },
      },
    });

    console.log(`[TAP API] Created invoice: ${invoiceNumber} for tenant: ${tenantId}`);

    return NextResponse.json({
      success: true,
      invoice: completeInvoice,
    });
  } catch (error: any) {
    console.error("[TAP API] Create invoice error:", error);
    return NextResponse.json(
      { error: "Failed to create invoice" },
      { status: 500 }
    );
  }
}

// GET - List invoices
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    // Validate request
    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const locationId = searchParams.get("locationId");
    const limit = parseInt(searchParams.get("limit") || "50");
    const offset = parseInt(searchParams.get("offset") || "0");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    // Build where clause
    const where: any = { tenantId };

    if (status) {
      where.status = status;
    }

    if (locationId) {
      where.locationId = locationId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate);
      }
    }

    // The Invoice model was removed from prisma/schema.prisma (replaced
    // by Order/Payment). The TypeScript-generated client no longer
    // exposes `prisma.invoice`, so any call here would throw
    // "Cannot read properties of undefined (reading 'findMany')" and
    // spam the logs every time the /dashboard/invoices page polls.
    // Until the page is removed (or the model reintroduced), return an
    // empty list so the UI renders the empty-state cleanly.
    if (!(prisma as any).invoice) {
      return NextResponse.json({
        success: true,
        invoices: [],
        pagination: { total: 0, limit, offset, hasMore: false },
      });
    }

    const [invoices, total] = await Promise.all([
      (prisma as any).invoice.findMany({
        where,
        include: {
          items: true,
          location: {
            select: { id: true, name: true },
          },
          payments: {
            select: { id: true, status: true, amount: true, completedAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
      }),
      (prisma as any).invoice.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      invoices,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + invoices.length < total,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] List invoices error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
