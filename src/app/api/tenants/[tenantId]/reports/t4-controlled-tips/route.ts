// GET /api/tenants/[tenantId]/reports/t4-controlled-tips?year=2026&locationId=<uuid>
//
// Canadian equivalent of the US Form 8027 report — but the mechanics
// are different, so the output shape is different too.
//
// CRA rules (T4127 / T4 filing guide):
//   - "Controlled tips" are tips the EMPLOYER collected and redistributed
//     (tip pools, auto-gratuities, service charges). They MUST be added
//     to employment income on T4 Box 14 and are subject to CPP / EI /
//     income tax withholding.
//   - "Direct tips" are handed straight from customer to employee (cash
//     tip, terminal-tip that isn't pooled). The employer only has to
//     inform the employee of their reporting duty; no T4 entry.
//
// Since every TipDistribution row is a pool distribution — i.e. the
// employer collected + redistributed — every distribution in this
// system is a controlled tip by definition. That maps cleanly to T4
// Box 14.
//
// Response:
//   {
//     year, period, establishment,
//     summary: { totalControlledTips, employeeCount },
//     employees: [{
//       membershipId, employeeName, sin (masked),
//       controlledTipsYearCents,
//       monthly: { "2026-01": 12345, ..., "2026-12": ... }
//     }]
//   }

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string }> };

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

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
    const year = Math.max(
      2020,
      Math.min(2100, isNaN(yearParam) ? new Date().getFullYear() : yearParam)
    );
    const locationId = searchParams.get("locationId") || undefined;

    const yearStart = new Date(Date.UTC(year, 0, 1));
    const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

    // Every CLOSED pool distribution counts as a controlled tip. Draft
    // or in-progress pools stay out — those numbers can still change and
    // the accountant expects finalised figures on T4 Box 14.
    const distributions = await prisma.tipDistribution.findMany({
      where: {
        pool: {
          tenantId,
          status: "CLOSED",
          periodStart: { gte: yearStart, lt: yearEnd },
          ...(locationId ? { locationId } : {}),
        },
      },
      select: {
        membershipId: true,
        shareAmount: true,
        pool: { select: { periodStart: true } },
        membership: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    // Aggregate per employee, per month.
    type Row = {
      membershipId: string;
      employeeName: string;
      email: string | null;
      yearTotal: number;
      monthly: Record<string, number>;
    };
    const byEmployee = new Map<string, Row>();

    for (const d of distributions) {
      const key = d.membershipId;
      const existing = byEmployee.get(key);
      const monthK = monthKey(d.pool.periodStart);
      if (existing) {
        existing.yearTotal += d.shareAmount;
        existing.monthly[monthK] = (existing.monthly[monthK] || 0) + d.shareAmount;
      } else {
        const first = d.membership?.firstName || "";
        const last = d.membership?.lastName || "";
        const name = (first + " " + last).trim() || d.membership?.email || "(unknown)";
        byEmployee.set(key, {
          membershipId: key,
          employeeName: name,
          email: d.membership?.email || null,
          yearTotal: d.shareAmount,
          monthly: { [monthK]: d.shareAmount },
        });
      }
    }

    // Also aggregate ALL twelve months on every row (with zero fill) so
    // the CSV export lines up column-for-column without post-processing.
    const allMonths: string[] = [];
    for (let m = 0; m < 12; m++) {
      allMonths.push(`${year}-${String(m + 1).padStart(2, "0")}`);
    }

    const employees = Array.from(byEmployee.values())
      .map((r) => ({
        ...r,
        monthly: Object.fromEntries(
          allMonths.map((mk) => [mk, r.monthly[mk] || 0])
        ),
      }))
      .sort((a, b) => b.yearTotal - a.yearTotal);

    const totalControlledTips = employees.reduce((s, e) => s + e.yearTotal, 0);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, currency: true },
    });
    const location = locationId
      ? await prisma.location.findUnique({
          where: { id: locationId },
          select: { name: true, address: true, province: true },
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
        province: location?.province || null,
        currency: tenant?.currency || "CAD",
      },
      months: allMonths,
      summary: {
        totalControlledTipsCents: totalControlledTips,
        employeeCount: employees.length,
        distributionCount: distributions.length,
      },
      employees,
      note:
        "Add each employee's yearTotal to T4 Box 14 (employment income). Withhold CPP/EI/tax as usual. Direct tips (customer → employee, no pool) are the employee's own reporting responsibility and are NOT included here.",
    });
  } catch (error: any) {
    console.error("[t4-controlled-tips] error:", error);
    return NextResponse.json(
      { error: error?.message || "Report failed" },
      { status: 500 }
    );
  }
}
