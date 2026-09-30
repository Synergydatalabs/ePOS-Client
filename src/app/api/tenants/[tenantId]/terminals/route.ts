import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET /api/tenants/[tenantId]/terminals — List all terminals
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const auth = await validateRequest(request, tenantId, "POS_STAFF");
  if (!auth.success) return auth.response;

  // Raw query so it works before Prisma schema is pulled post-migration.
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT t.id, t.location_id, t.name, t.ip_address, t.port, t.serial_number,
            t.model, t.status, t.is_default, t.last_ping_at, t.last_eod_at,
            t.ecr_id, t.metadata, t.created_at, t.updated_at,
            COALESCE(t.provider, 'UPA') AS provider,
            t.uci_lane, t.uci_merchant_id, COALESCE(t.uci_environment, 'CERT') AS uci_environment,
            l.name AS location_name
     FROM terminals t
     JOIN locations l ON t.location_id = l.id
     WHERE l.tenant_id = $1::uuid
     ORDER BY t.is_default DESC, t.name ASC`,
    tenantId
  );

  const terminals = rows.map((r) => ({
    id: r.id,
    locationId: r.location_id,
    name: r.name,
    provider: r.provider,
    uciLane: r.uci_lane,
    uciMerchantId: r.uci_merchant_id,
    uciEnvironment: r.uci_environment,
    ipAddress: r.ip_address,
    port: r.port,
    serialNumber: r.serial_number,
    model: r.model,
    status: r.status,
    isDefault: r.is_default,
    lastPingAt: r.last_ping_at,
    lastEodAt: r.last_eod_at,
    ecrId: r.ecr_id,
    metadata: r.metadata,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    location: { id: r.location_id, name: r.location_name },
  }));

  return NextResponse.json({ terminals });
}

// POST /api/tenants/[tenantId]/terminals — Register a new terminal.
// Defaults to UCI. Also accepts:
//   provider: "MONERIS" + serialNumber (Device ID) + optional model
//   provider: "UPA"     + ipAddress + port (legacy)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;

  try {
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const {
      locationId,
      name,
      provider = "UCI",
      // UCI fields
      uciLane,
      uciMerchantId,
      uciEnvironment = "CERT",
      // UPA (legacy) fields
      ipAddress,
      port = 8081,
      model,
      serialNumber,
      isDefault = false,
    } = body;

  if (!locationId || !name) {
    return NextResponse.json(
      { error: "locationId and name are required" },
      { status: 400 }
    );
  }

  if (provider === "UCI" && !uciLane) {
    return NextResponse.json(
      { error: "uciLane (Processing TID) is required for UCI terminals" },
      { status: 400 }
    );
  }

  if (provider === "MONERIS" && !serialNumber) {
    return NextResponse.json(
      { error: "serialNumber (Device ID) is required for Moneris terminals" },
      { status: 400 }
    );
  }

  if (provider === "UPA" && !ipAddress) {
    return NextResponse.json(
      { error: "ipAddress is required for UPA terminals" },
      { status: 400 }
    );
  }

  // Verify location belongs to tenant
  const location = await prisma.location.findFirst({
    where: { id: locationId, tenantId },
  });
  if (!location) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }

  // Duplicate checks — one row per provider identifier per location.
  if (provider === "UCI") {
    const dup: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM terminals WHERE location_id = $1::uuid AND uci_lane = $2 LIMIT 1`,
      locationId,
      uciLane
    );
    if (dup.length > 0) {
      return NextResponse.json(
        { error: `A terminal with Lane "${uciLane}" already exists at this location` },
        { status: 409 }
      );
    }
  } else if (provider === "MONERIS") {
    const dup: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM terminals WHERE location_id = $1::uuid AND provider = 'MONERIS' AND serial_number = $2 LIMIT 1`,
      locationId,
      serialNumber
    );
    if (dup.length > 0) {
      return NextResponse.json(
        { error: `A Moneris terminal with Device ID "${serialNumber}" already exists at this location` },
        { status: 409 }
      );
    }
  } else {
    const dup: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM terminals WHERE location_id = $1::uuid AND ip_address = $2 AND port = $3 LIMIT 1`,
      locationId,
      ipAddress,
      port
    );
    if (dup.length > 0) {
      return NextResponse.json(
        { error: "A terminal with this IP and port already exists at this location" },
        { status: 409 }
      );
    }
  }

  // Create terminal via raw SQL (so we can set the new UCI columns
  // before the Prisma schema is pulled post-migration).
  //
  // NOTE: `port` column is NOT NULL with default 8081. UCI terminals don't
  // need a port, but we still have to pass a non-null value — use 0 as a
  // sentinel meaning "N/A for cloud-connected terminals."
  const portValue = provider === "UPA" ? port : 0;

  const rows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO terminals (
       id, location_id, name, provider,
       uci_lane, uci_merchant_id, uci_environment,
       ip_address, port, serial_number, model,
       status, is_default, ecr_id,
       metadata, created_at, updated_at
     ) VALUES (
       gen_random_uuid(), $1::uuid, $2, $3,
       $4, $5, $6,
       $7, $8, $9, $10,
       'OFFLINE', $11, '13',
       $12::jsonb, NOW(), NOW()
     ) RETURNING id, location_id, name, provider, uci_lane, uci_merchant_id,
                  uci_environment, ip_address, port, serial_number, model,
                  status, is_default, ecr_id, metadata, created_at, updated_at`,
    locationId,
    name.trim(),
    provider,
    provider === "UCI" ? uciLane : null,
    provider === "UCI" ? uciMerchantId || null : null,
    provider === "UCI" ? uciEnvironment : null,
    provider === "UPA" ? ipAddress : null,
    portValue,
    serialNumber || null,
    model || null,
    isDefault,
    JSON.stringify({
      registeredVia:
        provider === "UCI"
          ? "manual_uci"
          : provider === "MONERIS"
          ? "manual_moneris"
          : "manual_upa",
      registeredAt: new Date().toISOString(),
    })
  );

    const r = rows[0];
    const terminal = {
      id: r.id,
      locationId: r.location_id,
      name: r.name,
      provider: r.provider,
      uciLane: r.uci_lane,
      uciMerchantId: r.uci_merchant_id,
      uciEnvironment: r.uci_environment,
      ipAddress: r.ip_address,
      port: r.port,
      status: r.status,
      isDefault: r.is_default,
      location: { id: location.id, name: location.name },
    };

    return NextResponse.json({ terminal }, { status: 201 });
  } catch (error: any) {
    console.error("[TERMINALS] Failed to save terminal:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to save terminal" },
      { status: 500 }
    );
  }
}
