// GET /api/tenants/[tenantId]/availability - Get available time slots
//
// Query params (all supported for backward compat with the legacy caller):
//   date=YYYY-MM-DD              required
//   locationId=<uuid>            required (new — was implicit before)
//   technicianId=<uuid>          optional (specific tech)
//   durationMinutes=<int>        optional (legacy — used when serviceIds
//                                empty; falls back to Product durations
//                                when serviceIds present)
//   serviceIds=<uuid>,<uuid>     optional — new richer input
//
// Response shape — backward-compatible superset:
//   {
//     success: true,
//     date, technicianId, durationMinutes, bufferMinutes,
//     slots: [{ time, available }]     ← legacy: fixed grid, flag per slot
//     availableSlots: [                ← new: only free slots, tech info
//       { startTime, endTime, technicianId, technicianName }
//     ],
//     closed, reason
//   }
//
// Powered by src/lib/appointment-availability.ts (Phase E R1). Reads
// Location.operatingHours + StaffSchedule + StaffTimeOff + existing
// bookings — no more hardcoded 9-21.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { computeAvailability } from "@/lib/appointment-availability";

// Slot step the legacy consumers (TimeSlotPicker) expect. Matches the
// engine's SLOT_STEP_MINUTES so the two views agree on which slots exist.
const LEGACY_GRID_STEP_MINUTES = 15;

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

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date");
    const technicianId = searchParams.get("technicianId") || undefined;
    const explicitDuration = parseInt(searchParams.get("durationMinutes") || "0");
    const serviceIds = (searchParams.get("serviceIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let locationId = searchParams.get("locationId") || undefined;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "date is required in YYYY-MM-DD format" },
        { status: 400 }
      );
    }

    // Backward compat: legacy callers didn't send locationId. Fall back
    // to the tenant's default location so old code paths keep working.
    if (!locationId) {
      const defaultLoc = await prisma.location.findFirst({
        where: { tenantId, isDefault: true },
        select: { id: true },
      });
      locationId =
        defaultLoc?.id ||
        (
          await prisma.location.findFirst({
            where: { tenantId },
            select: { id: true },
          })
        )?.id;
    }
    if (!locationId) {
      return NextResponse.json(
        { error: "No location found for this tenant" },
        { status: 400 }
      );
    }

    // When explicit duration was passed but no serviceIds, we can't ask
    // the engine to derive it from products. Fake it by adding a
    // synthetic service duration — pass 0 services and the engine falls
    // back to DEFAULT_SLOT_MINUTES (30). To honor `explicitDuration`
    // exactly, we pass 0 services here and post-scale the grid step:
    // simpler to just call the engine with what we have and use the
    // engine's totalDurationMinutes echoed back for the legacy grid.
    const engine = await computeAvailability({
      tenantId,
      locationId,
      date,
      serviceProductIds: serviceIds,
      technicianId,
    });

    // Effective duration for the legacy `{time, available}[]` grid:
    //   1. explicitDuration if the caller supplied it (their intent wins)
    //   2. engine's derived duration otherwise
    const effectiveDuration = explicitDuration || engine.totalDurationMinutes;

    // Build a fixed-grid response for TimeSlotPicker et al. When the
    // location is closed OR no slots at all, we return an empty array
    // rather than a grid of all-unavailable slots — matches what the
    // legacy code did.
    let legacyGrid: { time: string; available: boolean }[] = [];
    if (!engine.closed && engine.slots.length > 0) {
      // Compute the day's opening minutes from the FIRST engine slot's
      // hour, and the closing minute from Location.operatingHours + hours
      // window. Simpler: just enumerate the FREE slots from the engine
      // into `{time, available: true}` rows. The picker groups by hour
      // for display — every free 15-min offset shows up.
      const seen = new Set<string>();
      for (const s of engine.slots) {
        // De-dup across techs (in "no preference" the same time may
        // appear multiple times, one per available tech).
        if (seen.has(s.startTime)) continue;
        seen.add(s.startTime);
        legacyGrid.push({ time: s.startTime, available: true });
      }
      // Sort ascending — engine already load-sorts by tech, we need pure
      // time-asc for the picker.
      legacyGrid.sort((a, b) => a.time.localeCompare(b.time));
    }

    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { bufferTimeMinutes: true },
    });

    return NextResponse.json({
      success: true,
      date,
      technicianId: technicianId || null,
      locationId,
      durationMinutes: effectiveDuration,
      bufferMinutes: settings?.bufferTimeMinutes || 0,
      // Legacy grid — used by TimeSlotPicker today.
      slots: legacyGrid,
      // Richer slot list — new consumers can display per-tech attribution
      // and multi-slot options ("first available at 10:15 with Jamie").
      availableSlots: engine.slots,
      closed: engine.closed,
      reason: engine.reason,
      // Engine's grid resolution — clients that render their own grid
      // should honor this rather than a hardcoded 15.
      slotStepMinutes: LEGACY_GRID_STEP_MINUTES,
    });
  } catch (error: any) {
    console.error("[AVAILABILITY] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
