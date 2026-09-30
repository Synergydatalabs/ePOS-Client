// POST /api/tenants/[tenantId]/payment-links
//   Create a shareable payment link. Reuses the Order table so we don't
//   need a schema migration — the order carries a `[PAYMENT_LINK]` marker
//   in its `notes` field for easy filtering, no line items, and uses
//   Order.paymentStatus to track pending/paid state.
//
// GET /api/tenants/[tenantId]/payment-links
//   List payment links, paginated + filterable by status.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { format } from "date-fns";

type Params = { params: Promise<{ tenantId: string }> };

const LINK_MARKER = "[PAYMENT_LINK]"; // Marker in Order.notes for filtering

function resolveBaseUrl(
  request: NextRequest,
  customDomain: string | null | undefined
): string {
  if (customDomain) return `https://${customDomain}`;
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

async function generateOrderNumber(locationId: string) {
  const today = format(new Date(), "yyyyMMdd");
  const lastOrder = await prisma.order.findFirst({
    where: { locationId },
    orderBy: { displayNumber: "desc" },
    select: { displayNumber: true },
  });
  const displayNumber = (lastOrder?.displayNumber || 0) + 1;
  return {
    orderNumber: `PLNK-${today}-${String(displayNumber).padStart(6, "0")}`,
    displayNumber,
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const {
      amount,
      description,
      customerName,
      customerEmail,
      customerPhone,
      expiresInDays,
      locationId: bodyLocationId,
    } = body;

    const amountCents = Math.floor(Number(amount));
    if (!amountCents || amountCents <= 0) {
      return NextResponse.json(
        { error: "Amount must be a positive number of cents" },
        { status: 400 }
      );
    }

    // Resolve location: use provided one if valid, else the tenant's default
    // (first active). Payment links are tenant-scoped but every Order needs
    // a location per the schema (@relation required).
    let locationId = bodyLocationId as string | undefined;
    if (!locationId) {
      const loc = await prisma.location.findFirst({
        where: { tenantId, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!loc) {
        return NextResponse.json(
          { error: "No active location found for this tenant" },
          { status: 400 }
        );
      }
      locationId = loc.id;
    } else {
      // Validate provided location belongs to tenant
      const loc = await prisma.location.findFirst({
        where: { id: locationId, tenantId },
        select: { id: true },
      });
      if (!loc) {
        return NextResponse.json(
          { error: "Location does not belong to this tenant" },
          { status: 404 }
        );
      }
    }

    const { orderNumber, displayNumber } = await generateOrderNumber(locationId);

    // Prefix notes with the marker so the list endpoint can filter cheaply.
    // Description (if any) follows on the next line.
    const notes = description
      ? `${LINK_MARKER}\n${String(description).slice(0, 500)}`
      : LINK_MARKER;

    const expiresAt = expiresInDays
      ? new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000)
      : null;

    // Load tenant + settings for the shareable URL host
    const tenantRow = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        settings: { select: { customDomain: true } },
      },
    });

    const order = await prisma.order.create({
      data: {
        locationId,
        orderNumber,
        displayNumber,
        orderType: "TAKEAWAY",
        status: "NEW",
        subtotal: amountCents,
        total: amountCents,
        currency: "CAD",
        customerName: customerName ? String(customerName).slice(0, 255) : null,
        customerPhone: customerPhone ? String(customerPhone).slice(0, 20) : null,
        customerEmail: customerEmail ? String(customerEmail).slice(0, 255) : null,
        notes,
        paymentStatus: "PENDING",
        paymentExpiresAt: expiresAt,
      },
    });

    const baseUrl = resolveBaseUrl(request, tenantRow?.settings?.customDomain);
    const url = `${baseUrl}/pay/${order.id}`;

    return NextResponse.json({
      success: true,
      link: {
        id: order.id,
        url,
        amount: amountCents,
        currency: order.currency,
        description: description || null,
        customerName: order.customerName,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        expiresAt: order.paymentExpiresAt,
        paymentStatus: order.paymentStatus,
        createdAt: order.createdAt,
      },
    });
  } catch (error: any) {
    console.error("[payment-links] POST error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to create payment link",
        code: error?.code || null,
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status"); // pending | paid | expired | cancelled | all
    const search = (searchParams.get("search") || "").trim();
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "25", 10) || 25)
    );

    // Load tenant + settings once for URL building
    const tenantRow = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { settings: { select: { customDomain: true } } },
    });
    const baseUrl = resolveBaseUrl(request, tenantRow?.settings?.customDomain);

    // Base filter: all orders for this tenant flagged as payment links
    const where: any = {
      location: { tenantId },
      notes: { startsWith: LINK_MARKER },
    };

    // Status filter
    if (status === "paid") {
      where.paymentStatus = "COMPLETED";
    } else if (status === "pending") {
      where.paymentStatus = "PENDING";
      where.status = { not: "CANCELLED" };
    } else if (status === "cancelled") {
      where.status = "CANCELLED";
    } else if (status === "expired") {
      where.paymentStatus = "PENDING";
      where.paymentExpiresAt = { lt: new Date() };
    }

    // Search: customer email / phone / name / order number
    if (search) {
      where.OR = [
        { customerEmail: { contains: search, mode: "insensitive" } },
        { customerPhone: { contains: search } },
        { customerName: { contains: search, mode: "insensitive" } },
        { orderNumber: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, orders] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          orderNumber: true,
          total: true,
          currency: true,
          customerName: true,
          customerEmail: true,
          customerPhone: true,
          paymentStatus: true,
          status: true,
          notes: true,
          paymentExpiresAt: true,
          paidAt: true,
          createdAt: true,
        },
      }),
    ]);

    const now = new Date();
    const links = orders.map((o) => {
      const desc =
        o.notes && o.notes.startsWith(LINK_MARKER)
          ? o.notes.substring(LINK_MARKER.length).trimStart()
          : null;
      const isExpired =
        o.paymentStatus === "PENDING" &&
        o.paymentExpiresAt &&
        o.paymentExpiresAt < now;
      let effectiveStatus: "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";
      if (o.status === "CANCELLED") effectiveStatus = "CANCELLED";
      else if (o.paymentStatus === "COMPLETED") effectiveStatus = "PAID";
      else if (isExpired) effectiveStatus = "EXPIRED";
      else effectiveStatus = "PENDING";

      return {
        id: o.id,
        url: `${baseUrl}/pay/${o.id}`,
        orderNumber: o.orderNumber,
        amount: o.total,
        currency: o.currency,
        description: desc,
        customerName: o.customerName,
        customerEmail: o.customerEmail,
        customerPhone: o.customerPhone,
        status: effectiveStatus,
        expiresAt: o.paymentExpiresAt,
        paidAt: o.paidAt,
        createdAt: o.createdAt,
      };
    });

    return NextResponse.json({
      success: true,
      links,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error: any) {
    console.error("[payment-links] GET error:", error);
    return NextResponse.json(
      {
        error: error?.message || "Failed to load payment links",
        code: error?.code || null,
      },
      { status: 500 }
    );
  }
}
