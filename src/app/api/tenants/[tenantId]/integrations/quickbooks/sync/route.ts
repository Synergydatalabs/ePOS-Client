// POST /api/tenants/[tenantId]/integrations/quickbooks/sync
//   Body: { region: 'US'|'CA', businessDate: 'YYYY-MM-DD', locationId?, dryRun? }
//
// Push a daily-sales JournalEntry to QBO. Idempotency guard: if a
// non-dry-run push already succeeded for the same (connection,
// business_date), we short-circuit with the existing sync-log row so
// double-clicks don't produce duplicate JEs.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { postJournalEntry, regionToProvider, type Region } from "@/lib/quickbooks";
import { buildDailyJournal } from "@/lib/quickbooks-journal";

type Params = { params: Promise<{ tenantId: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const region = (body.region || "US") as Region;
    const dryRun = body.dryRun === true;
    const businessDateStr = body.businessDate as string | undefined;
    const locationId = body.locationId as string | undefined;

    if (!businessDateStr) {
      return NextResponse.json(
        { error: "businessDate (YYYY-MM-DD) is required" },
        { status: 400 }
      );
    }
    const businessDate = new Date(businessDateStr + "T00:00:00Z");
    if (isNaN(businessDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid businessDate" },
        { status: 400 }
      );
    }

    const conn = await prisma.integrationConnection.findUnique({
      where: {
        tenantId_provider: { tenantId, provider: regionToProvider(region) },
      },
    });
    if (!conn || conn.status !== "CONNECTED") {
      return NextResponse.json(
        { error: `QuickBooks ${region} is not connected` },
        { status: 400 }
      );
    }

    // Idempotency: block real pushes if one already succeeded for this
    // business date. Dry-runs are always allowed since they don't
    // mutate anything in QBO.
    if (!dryRun) {
      const existing = await prisma.integrationSyncLog.findFirst({
        where: {
          connectionId: conn.id,
          businessDate,
          dryRun: false,
          success: true,
        },
      });
      if (existing) {
        return NextResponse.json(
          {
            error: `Already pushed a JE for ${businessDateStr} (QBO ref ${existing.externalRef})`,
            existingSyncLogId: existing.id,
          },
          { status: 409 }
        );
      }
    }

    // Build the entry regardless of dry-run so admin can see the preview
    let built;
    try {
      built = await buildDailyJournal({
        connectionId: conn.id,
        businessDate,
        locationId,
      });
    } catch (err: any) {
      return NextResponse.json(
        { error: err?.message || "Failed to build journal" },
        { status: 500 }
      );
    }

    if (dryRun) {
      // Log the preview attempt for audit, but don't call QBO
      const log = await prisma.integrationSyncLog.create({
        data: {
          connectionId: conn.id,
          businessDate,
          dryRun: true,
          success: true,
          payload: built.entry,
          performedById: auth.context.membership.id,
        },
      });
      return NextResponse.json({
        success: true,
        dryRun: true,
        preview: built,
        syncLogId: log.id,
      });
    }

    // Real push
    try {
      const result = await postJournalEntry(conn.id, built.entry);
      const log = await prisma.integrationSyncLog.create({
        data: {
          connectionId: conn.id,
          businessDate,
          dryRun: false,
          success: true,
          payload: built.entry,
          response: result.raw as any,
          externalRef: result.id,
          performedById: auth.context.membership.id,
        },
      });
      await prisma.integrationConnection.update({
        where: { id: conn.id },
        data: { lastSyncAt: new Date(), lastError: null, lastErrorAt: null },
      });
      return NextResponse.json({
        success: true,
        externalRef: result.id,
        preview: built,
        syncLogId: log.id,
      });
    } catch (err: any) {
      await prisma.integrationSyncLog.create({
        data: {
          connectionId: conn.id,
          businessDate,
          dryRun: false,
          success: false,
          payload: built.entry,
          error: err?.message || String(err),
          performedById: auth.context.membership.id,
        },
      });
      await prisma.integrationConnection.update({
        where: { id: conn.id },
        data: {
          status: "ERROR",
          lastError: err?.message || "Sync failed",
          lastErrorAt: new Date(),
        },
      });
      return NextResponse.json(
        { error: err?.message || "Sync failed", preview: built },
        { status: 502 }
      );
    }
  } catch (error: any) {
    console.error("[qbo sync] error:", error);
    return NextResponse.json(
      { error: error?.message || "Sync failed" },
      { status: 500 }
    );
  }
}
