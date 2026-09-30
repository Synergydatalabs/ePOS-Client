// GET /api/tenants/[tenantId]/cab/debug — Diagnostic endpoint for cab data
// Hit this in the browser to see exactly what's working and what's failing

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const results: Record<string, any> = { tenantId, timestamp: new Date().toISOString() };

  // Test 1: Basic Prisma connection
  try {
    const tenantCheck: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, name, business_type FROM tenants WHERE id = $1::uuid`,
      tenantId
    );
    results.tenant = tenantCheck[0] || "NOT FOUND";
  } catch (e: any) {
    results.tenant = { error: e.message };
  }

  // Test 2: driver_profiles table
  try {
    const drivers: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM driver_profiles WHERE tenant_id = $1::uuid`,
      tenantId
    );
    results.driverProfiles = { count: drivers[0]?.count || 0 };
  } catch (e: any) {
    results.driverProfiles = { error: e.message };
  }

  // Test 3: vehicles table
  try {
    const vehicles: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM vehicles WHERE tenant_id = $1::uuid`,
      tenantId
    );
    results.vehicles = { count: vehicles[0]?.count || 0 };
  } catch (e: any) {
    results.vehicles = { error: e.message };
  }

  // Test 4: zones table
  try {
    const zones: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM zones WHERE tenant_id = $1::uuid`,
      tenantId
    );
    results.zones = { count: zones[0]?.count || 0 };
  } catch (e: any) {
    results.zones = { error: e.message };
  }

  // Test 5: fare_rules table
  try {
    const fares: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM fare_rules WHERE tenant_id = $1::uuid`,
      tenantId
    );
    results.fareRules = { count: fares[0]?.count || 0 };
  } catch (e: any) {
    results.fareRules = { error: e.message };
  }

  // Test 6: trips table
  try {
    const trips: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM trips WHERE tenant_id = $1::uuid`,
      tenantId
    );
    results.trips = { count: trips[0]?.count || 0 };
  } catch (e: any) {
    results.trips = { error: e.message };
  }

  // Test 7: promo_codes table
  try {
    const promos: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM promo_codes WHERE tenant_id = $1::uuid`,
      tenantId
    );
    results.promoCodes = { count: promos[0]?.count || 0 };
  } catch (e: any) {
    results.promoCodes = { error: e.message };
  }

  // Test 8: memberships for this tenant
  try {
    const members: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM memberships WHERE tenant_id = $1::uuid`,
      tenantId
    );
    results.memberships = { count: members[0]?.count || 0 };
  } catch (e: any) {
    results.memberships = { error: e.message };
  }

  // Test 9: The actual drivers query (the one that fails)
  try {
    const drivers: any[] = await prisma.$queryRawUnsafe(
      `SELECT dp.id, m.first_name, m.last_name, m.email, dp.duty_status
       FROM driver_profiles dp
       JOIN memberships m ON dp.membership_id = m.id
       WHERE dp.tenant_id = $1::uuid`,
      tenantId
    );
    results.driversQuery = { count: drivers.length, rows: drivers };
  } catch (e: any) {
    results.driversQuery = { error: e.message, stack: e.stack?.split("\n").slice(0, 3) };
  }

  // Test 10: Staff query via Prisma ORM (the one with phone bug)
  try {
    const staff = await prisma.membership.findMany({
      where: { tenantId, status: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
    });
    results.staffQuery = { count: staff.length, rows: staff };
  } catch (e: any) {
    results.staffQuery = { error: e.message };
  }

  return NextResponse.json(results, {
    headers: { "Content-Type": "application/json" },
  });
}
