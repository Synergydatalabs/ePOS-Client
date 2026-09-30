// POST /api/tenants/[tenantId]/locations/[locationId]/tables/bulk - Bulk create tables

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
  // Fallback: use the request origin so QR always points somewhere valid.
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

// POST - Bulk create tables (each with its own QR code)
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
    const {
      startNumber = 1,
      count,
      prefix = "",
      capacity = 4,
    } = body;

    if (!count || count < 1 || count > 100) {
      return NextResponse.json(
        { error: "Count must be between 1 and 100" },
        { status: 400 }
      );
    }

    // Validate location + load tenant for white-label QR URL
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

    // tableNumber column is VARCHAR — compare + insert as strings so Prisma
    // (and any subsequent findMany queries) don't blow up on type mismatch.
    const existingTables = await prisma.table.findMany({
      where: { locationId },
      select: { tableNumber: true },
    });
    const existingNumbers = new Set(
      existingTables.map((t) => String(t.tableNumber))
    );

    const baseUrl = resolveBaseUrl(
      request,
      location.tenant?.settings?.customDomain
    );

    // Build the list of tables to create, each with a freshly-generated QR
    const tablesToCreate: Array<{
      locationId: string;
      tableNumber: string;
      name: string;
      capacity: number;
      status: "AVAILABLE";
      qrCode: string;
      qrCodeUrl: string;
    }> = [];

    let currentNumber = Number(startNumber);
    let created = 0;

    while (created < count) {
      const candidate = String(currentNumber);
      if (!existingNumbers.has(candidate)) {
        const qrCode = nanoid(12);
        const qrUrl = `${baseUrl}/table/${qrCode}`;
        const qrCodeUrl = await QRCode.toDataURL(qrUrl, {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 300,
        });

        tablesToCreate.push({
          locationId,
          tableNumber: candidate,
          name: prefix ? `${prefix} ${candidate}` : `Table ${candidate}`,
          capacity,
          status: "AVAILABLE",
          qrCode,
          qrCodeUrl,
        });
        created++;
      }
      currentNumber++;

      // Safety limit — don't loop forever if numbers are all taken
      if (currentNumber > Number(startNumber) + count * 2) {
        break;
      }
    }

    if (tablesToCreate.length === 0) {
      return NextResponse.json(
        { error: "No tables could be created (all numbers already exist)" },
        { status: 409 }
      );
    }

    await prisma.table.createMany({ data: tablesToCreate });

    // Fetch created tables — tableNumber is a string, `in` needs strings
    const tables = await prisma.table.findMany({
      where: {
        locationId,
        tableNumber: { in: tablesToCreate.map((t) => t.tableNumber) },
      },
      orderBy: { tableNumber: "asc" },
    });

    console.log(
      `[TAP API] Bulk created ${tables.length} tables at ${location.name} (each with QR)`
    );

    return NextResponse.json({
      success: true,
      message: `Created ${tables.length} tables`,
      created: tables.length,
      tables,
    });
  } catch (error: any) {
    console.error("[TAP API] Bulk create tables error:", error);
    return NextResponse.json(
      { error: "Failed to create tables" },
      { status: 500 }
    );
  }
}
