// POST /api/tenants/[tenantId]/locations/[locationId]/tables - Create table
// GET /api/tenants/[tenantId]/locations/[locationId]/tables - List tables

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import QRCode from "qrcode";
import { nanoid } from "nanoid";

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

// POST - Create table
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; locationId: string }> }
) {
  try {
    const { tenantId, locationId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { tableNumber, name, capacity = 4 } = body;

    if (!tableNumber) {
      return NextResponse.json(
        { error: "Table number is required" },
        { status: 400 }
      );
    }

    // Validate location and load tenant for white-label QR URL
    // customDomain lives on TenantSettings, not Tenant itself.
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId },
      include: {
        tenant: {
          select: {
            settings: { select: { customDomain: true } },
          },
        },
      },
    });

    if (!location) {
      return NextResponse.json(
        { error: "Location not found" },
        { status: 404 }
      );
    }

    // Check for duplicate table number (tableNumber is a string in schema)
    const tableNumberStr = String(tableNumber);
    const existing = await prisma.table.findFirst({
      where: { locationId, tableNumber: tableNumberStr },
    });

    if (existing) {
      return NextResponse.json(
        { error: "Table with this number already exists at this location" },
        { status: 409 }
      );
    }

    // Generate unique QR code — resolveBaseUrl falls back to the request
    // origin if neither customDomain nor NEXT_PUBLIC_APP_URL is set, so we
    // never produce an "undefined/table/xxx" QR.
    const qrCode = nanoid(12);
    const baseUrl = resolveBaseUrl(
      request,
      location.tenant?.settings?.customDomain
    );
    const qrUrl = `${baseUrl}/table/${qrCode}`;

    // Generate QR code data URL
    const qrCodeUrl = await QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 300,
    });

    const table = await prisma.table.create({
      data: {
        locationId,
        tableNumber: tableNumberStr,
        name: name?.trim() || `Table ${tableNumberStr}`,
        capacity,
        status: "AVAILABLE",
        qrCode,
        qrCodeUrl,
      },
    });

    console.log(`[TAP API] Created table: ${table.name} at ${location.name} with QR: ${qrCode}`);

    return NextResponse.json({
      success: true,
      table,
    });
  } catch (error: any) {
    console.error("[TAP API] Create table error:", error);
    return NextResponse.json(
      { error: "Failed to create table" },
      { status: 500 }
    );
  }
}

// GET - List tables
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
    const status = searchParams.get("status");

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

    const where: any = { locationId };
    if (status) {
      where.status = status;
    }

    const tables = await prisma.table.findMany({
      where,
      include: {
        orders: {
          where: {
            status: { notIn: ["COMPLETED", "CANCELLED"] },
          },
          select: {
            id: true,
            orderNumber: true,
            displayNumber: true,
            status: true,
            total: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        sessions: {
          where: {
            status: { in: ["ACTIVE", "ORDERING", "DINING", "PAYMENT_PENDING"] },
          },
          select: {
            id: true,
            guestCount: true,
            status: true,
            totalSpent: true,
            startedAt: true,
            lastActivityAt: true,
            guests: {
              select: {
                id: true,
                guestName: true,
                isHost: true,
              },
            },
            _count: {
              select: {
                orders: true,
                requests: true,
              },
            },
          },
          orderBy: { startedAt: "desc" },
          take: 1,
        },
      },
      orderBy: { tableNumber: "asc" },
    });

    // Add current order and session info to each table
    const tablesWithOrders = tables.map((table) => ({
      ...table,
      currentOrder: table.orders[0] || null,
      hasActiveOrder: table.orders.length > 0,
      currentSession: table.sessions[0] || null,
      hasActiveSession: table.sessions.length > 0,
    }));

    // Summary counts
    const summary = {
      total: tables.length,
      available: tables.filter((t) => t.status === "AVAILABLE").length,
      occupied: tables.filter((t) => t.status === "OCCUPIED").length,
      reserved: tables.filter((t) => t.status === "RESERVED").length,
      cleaning: tables.filter((t) => t.status === "CLEANING").length,
    };

    return NextResponse.json({
      success: true,
      tables: tablesWithOrders,
      summary,
    });
  } catch (error: any) {
    console.error("[TAP API] List tables error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
