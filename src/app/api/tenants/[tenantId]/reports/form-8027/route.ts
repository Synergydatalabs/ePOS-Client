// GET /api/tenants/[tenantId]/reports/form-8027?year=2026&locationId=<uuid>
//
// Compute the values a US employer needs to fill out IRS Form 8027
// ("Employer's Annual Information Return of Tip Income and Allocated
// Tips"). Applies to food/beverage establishments with more than 10
// tipped employees.
//
// This endpoint returns COMPUTED values — the merchant (or their
// accountant) still transcribes them onto the official IRS form. We
// never generate the actual PDF because the form changes yearly and
// the IRS provides fillable versions.
//
// Line map (2025 form; recheck yearly):
//   Line 1  — Total charged tips: tips paid on card/electronic sales.
//             Comes from Order.tipAmount where payment.method != cash.
//   Line 2  — Total charge receipts showing charged tips: subtotal (or
//             total?) of orders where tips were charged. We use
//             Order.total to align with IRS "gross receipts of tipped
//             sales" language.
//   Line 3  — Service charges < 10% paid as wages to employees. We
//             don't distinguish auto-gratuity yet — reported as 0 with
//             a note so the accountant can override.
//   Line 4a — Tips reported by INDIRECTLY tipped employees (bar-back,
//             busboys). Populated from TipDistribution rows where the
//             receiving member's role is KITCHEN_STAFF or lower.
//   Line 4b — Tips reported by DIRECTLY tipped employees (servers).
//             From TipDistribution rows for POS_STAFF and POS_MANAGER.
//   Line 4c — 4a + 4b (server computes to save admin math).
//   Line 5  — Gross food/beverage receipts (subtotal for the year).
//   Line 6  — Line 5 × 0.08 (8% — default IRS rate).
//   Line 7  — Allocation of tips = max(0, Line 6 - Line 4c). If > 0,
//             merchant must allocate that amount across staff.
//   Line 8  — Count of DIRECTLY tipped employees (distinct POS_STAFF /
//             POS_MANAGER members who received a TipDistribution share).

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

const DIRECT_TIP_ROLES = new Set(["POS_STAFF", "POS_MANAGER"]);

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const yearParam = parseInt(
      searchParams.get("year") || String(new Date().getFullYear()),
      10
    );
    const year = Math.max(2020, Math.min(2100, isNaN(yearParam) ? new Date().getFullYear() : yearParam));
    const locationId = searchParams.get("locationId") || undefined;

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

    // Base order filter for the tax year. Cancelled orders are excluded
    // because they weren't actually receipts.
    const orderWhere: any = {
      location: { tenantId },
      createdAt: { gte: yearStart, lt: yearEnd },
      status: { not: "CANCELLED" },
      paymentStatus: "COMPLETED",
      ...(locationId ? { locationId } : {}),
    };

    // ── Line 1 + Line 2 (charged tips + charged receipts) ────────────
    // Rely on Payment.method to distinguish card vs cash. We aggregate
    // via a raw query since Prisma's groupBy doesn't handle the nested
    // filter cleanly.
    const chargedTipsAgg = await prisma.$queryRawUnsafe<
      Array<{ charged_tips: bigint | null; charge_receipts: bigint | null; count: bigint }>
    >(
      `
      SELECT
        COALESCE(SUM(o.tip_amount), 0)::bigint AS charged_tips,
        COALESCE(SUM(o.total), 0)::bigint AS charge_receipts,
        COUNT(DISTINCT o.id)::bigint AS count
      FROM orders o
      JOIN locations l ON l.id = o.location_id
      WHERE l.tenant_id = $1::uuid
        AND o.created_at >= $2::timestamptz
        AND o.created_at <  $3::timestamptz
        AND o.status <> 'CANCELLED'
        AND o.payment_status = 'COMPLETED'
        AND o.tip_amount > 0
        AND EXISTS (
          SELECT 1 FROM payments p
          WHERE p.order_id = o.id
            AND p.status = 'COMPLETED'
            AND lower(coalesce(p.method, p.provider)) NOT IN ('cash', 'gift_card')
        )
        ${locationId ? "AND o.location_id = $4::uuid" : ""}
      `,
      tenantId,
      yearStart,
      yearEnd,
      ...(locationId ? [locationId] : [])
    );

    const line1 = Number(chargedTipsAgg[0]?.charged_tips || 0);
    const line2 = Number(chargedTipsAgg[0]?.charge_receipts || 0);
    const chargedOrderCount = Number(chargedTipsAgg[0]?.count || 0);

    // ── Line 4a / 4b / 4c (reported tips via TipDistribution) ────────
    // Sum shares per role bucket. Only closed pools count — draft /
    // distributed pools might still change and the accountant expects
    // finalised numbers.
    const distributions = await prisma.tipDistribution.findMany({
      where: {
        pool: {
          tenantId,
          status: "CLOSED",
          periodStart: { gte: yearStart, lt: yearEnd },
          ...(locationId ? { locationId } : {}),
        },
      },
      select: { role: true, shareAmount: true, membershipId: true },
    });

    let line4a = 0;
    let line4b = 0;
    const directTippedMembers = new Set<string>();
    for (const d of distributions) {
      if (DIRECT_TIP_ROLES.has(d.role)) {
        line4b += d.shareAmount;
        directTippedMembers.add(d.membershipId);
      } else {
        line4a += d.shareAmount;
      }
    }
    const line4c = line4a + line4b;

    // ── Line 5 (gross receipts) ──────────────────────────────────────
    // Full-year subtotal from paid orders — Form 8027 asks for
    // food/beverage receipts. Merchants selling non-F&B alongside
    // (retail, gift cards) should override this in their accountant's
    // workpaper; we surface the raw sum + a helpful note.
    const grossAgg = await prisma.order.aggregate({
      where: orderWhere,
      _sum: { subtotal: true },
      _count: { _all: true },
    });
    const line5 = grossAgg._sum.subtotal || 0;
    const totalOrders = grossAgg._count._all;

    // ── Line 6 + Line 7 (8% allocation) ──────────────────────────────
    const line6 = Math.round(line5 * 0.08);
    const line7 = Math.max(0, line6 - line4c);

    // ── Line 8 (directly tipped employee count) ──────────────────────
    const line8 = directTippedMembers.size;

    // Establishment info for the report header
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, currency: true },
    });
    const location = locationId
      ? await prisma.location.findUnique({
          where: { id: locationId },
          select: { name: true, address: true },
        })
      : null;

    return NextResponse.json({
      success: true,
      year,
      period: { start: yearStart.toISOString(), end: yearEnd.toISOString() },
      establishment: {
        tenantName: tenant?.name || null,
        locationName: location?.name || null,
        locationAddress: location?.address || null,
        currency: tenant?.currency || "CAD",
      },
      lines: {
        line1: {
          amount: line1,
          label: "Total charged tips",
          detail: `${chargedOrderCount} card/electronic orders w/ tips`,
        },
        line2: {
          amount: line2,
          label: "Total charge receipts showing tips",
        },
        line3: {
          amount: 0,
          label: "Service charges < 10% paid as wages",
          detail: "Auto-gratuity not yet tracked; override with accountant",
        },
        line4a: {
          amount: line4a,
          label: "Tips reported by indirectly tipped employees",
        },
        line4b: {
          amount: line4b,
          label: "Tips reported by directly tipped employees",
        },
        line4c: {
          amount: line4c,
          label: "Total tips reported (4a + 4b)",
        },
        line5: {
          amount: line5,
          label: "Gross receipts from F&B operations",
          detail: `${totalOrders} paid orders in ${year}`,
        },
        line6: {
          amount: line6,
          label: "Line 5 × 8% (default allocation base)",
        },
        line7: {
          amount: line7,
          label: "Allocation of tips (Line 6 − Line 4c, floored at 0)",
          detail:
            line7 > 0
              ? "Tips must be allocated to employees"
              : "No allocation required — reported tips exceed 8%",
        },
        line8: {
          amount: line8,
          label: "Directly tipped employees",
        },
      },
    });
  } catch (error: any) {
    console.error("[form-8027] error:", error);
    return NextResponse.json(
      { error: error?.message || "Report failed" },
      { status: 500 }
    );
  }
}
