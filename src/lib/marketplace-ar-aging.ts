// AR aging + statements — Phase D #75.
//
// Outstanding = PO's paymentStatus is NOT PAID and PO status is NOT
// CANCELLED. That covers UNPAID + PENDING + FAILED + REFUNDED. (Refunds
// as "unpaid" is a v1 shortcut — a supplier who refunded is effectively
// owed nothing, but until we track adjustments explicitly, showing them
// in the outstanding bucket is louder + safer than dropping them.)
//
// Aging bucket is derived from (today - dueDate) where
//   dueDate = submittedAt + defaultNetTermsDays
// A future dueDate = "Not yet due" bucket. Past-due goes into 1-30,
// 31-60, 61-90, or 90+ buckets. No database materialization — always
// computed fresh so terms changes take effect immediately.
//
// One helper for the ROLLUP (per-merchant totals) that the /statements
// index page uses; another for the DETAIL (one merchant's open POs)
// that the /statements/[merchantId] page + email statement use.

import prisma from "@/lib/prisma";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type AgingBucket =
  | "notYetDue"
  | "1_30"
  | "31_60"
  | "61_90"
  | "over_90";

const BUCKETS: AgingBucket[] = ["notYetDue", "1_30", "31_60", "61_90", "over_90"];

export interface AgingBreakdown {
  notYetDue: number;
  "1_30": number;
  "31_60": number;
  "61_90": number;
  over_90: number;
}

export function emptyAging(): AgingBreakdown {
  return { notYetDue: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
}

function ageBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return "notYetDue";
  if (daysOverdue <= 30) return "1_30";
  if (daysOverdue <= 60) return "31_60";
  if (daysOverdue <= 90) return "61_90";
  return "over_90";
}

interface OpenPoRow {
  id: string;
  poNumber: string;
  merchantTenantId: string;
  submittedAt: Date;
  totalCents: number;
  paidAmountCents: number | null;
  currency: string;
  status: string;
  paymentStatus: string;
}

async function loadOpenPos(supplierTenantId: string): Promise<OpenPoRow[]> {
  return prisma.purchaseOrder.findMany({
    where: {
      supplierTenantId,
      status: { not: "CANCELLED" },
      paymentStatus: { not: "PAID" },
    },
    select: {
      id: true,
      poNumber: true,
      merchantTenantId: true,
      submittedAt: true,
      totalCents: true,
      paidAmountCents: true,
      currency: true,
      status: true,
      paymentStatus: true,
    },
    orderBy: { submittedAt: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MerchantAgingRow {
  merchantTenantId: string;
  merchantName: string;
  poCount: number;
  totalOutstandingCents: number;
  currency: string;
  aging: AgingBreakdown;
  oldestSubmittedAt: Date;
  oldestDaysOverdue: number;
}

/**
 * Aggregate view — one row per merchant with an outstanding balance.
 * Powers the /supplier/statements index page.
 */
export async function loadSupplierAging(
  supplierTenantId: string
): Promise<{
  netTermsDays: number;
  totals: {
    totalOutstandingCents: number;
    aging: AgingBreakdown;
    currency: string;
    merchantCount: number;
    poCount: number;
  };
  rows: MerchantAgingRow[];
}> {
  const profile = await prisma.supplierProfile.findUnique({
    where: { tenantId: supplierTenantId },
    select: { defaultNetTermsDays: true, currency: true },
  });
  const netTermsDays = profile?.defaultNetTermsDays ?? 30;
  const currency = profile?.currency ?? "CAD";

  const pos = await loadOpenPos(supplierTenantId);
  if (pos.length === 0) {
    return {
      netTermsDays,
      totals: {
        totalOutstandingCents: 0,
        aging: emptyAging(),
        currency,
        merchantCount: 0,
        poCount: 0,
      },
      rows: [],
    };
  }

  // Look up merchant display names in one round-trip.
  const merchantIds = Array.from(new Set(pos.map((p) => p.merchantTenantId)));
  const merchants = await prisma.tenant.findMany({
    where: { id: { in: merchantIds } },
    select: { id: true, name: true },
  });
  const merchantNames = new Map(merchants.map((m) => [m.id, m.name]));

  const now = Date.now();

  // Group POs by merchant.
  const rowsByMerchant = new Map<string, MerchantAgingRow>();
  const grandAging = emptyAging();
  let grandTotal = 0;

  for (const po of pos) {
    const outstanding = po.totalCents - (po.paidAmountCents ?? 0);
    if (outstanding <= 0) continue; // fully paid via partial credits
    const dueMs = po.submittedAt.getTime() + netTermsDays * MS_PER_DAY;
    const daysOverdue = Math.floor((now - dueMs) / MS_PER_DAY);
    const bucket = ageBucket(daysOverdue);

    let row = rowsByMerchant.get(po.merchantTenantId);
    if (!row) {
      row = {
        merchantTenantId: po.merchantTenantId,
        merchantName: merchantNames.get(po.merchantTenantId) || "Unknown merchant",
        poCount: 0,
        totalOutstandingCents: 0,
        currency: po.currency,
        aging: emptyAging(),
        oldestSubmittedAt: po.submittedAt,
        oldestDaysOverdue: daysOverdue,
      };
      rowsByMerchant.set(po.merchantTenantId, row);
    }
    row.poCount++;
    row.totalOutstandingCents += outstanding;
    row.aging[bucket] += outstanding;
    if (po.submittedAt < row.oldestSubmittedAt) {
      row.oldestSubmittedAt = po.submittedAt;
      row.oldestDaysOverdue = daysOverdue;
    }

    grandTotal += outstanding;
    grandAging[bucket] += outstanding;
  }

  // Sort merchants by biggest balance first — helps supplier focus on
  // whoever owes the most.
  const rows = Array.from(rowsByMerchant.values()).sort(
    (a, b) => b.totalOutstandingCents - a.totalOutstandingCents
  );

  return {
    netTermsDays,
    totals: {
      totalOutstandingCents: grandTotal,
      aging: grandAging,
      currency,
      merchantCount: rows.length,
      poCount: pos.length,
    },
    rows,
  };
}

export interface StatementLine {
  poId: string;
  poNumber: string;
  submittedAt: Date;
  dueDate: Date;
  daysOverdue: number;
  bucket: AgingBucket;
  totalCents: number;
  paidAmountCents: number;
  outstandingCents: number;
  status: string;
  paymentStatus: string;
  currency: string;
}

export interface MerchantStatement {
  merchantTenantId: string;
  merchantName: string;
  merchantEmail: string | null;
  supplierName: string;
  netTermsDays: number;
  currency: string;
  asOf: Date;
  lines: StatementLine[];
  aging: AgingBreakdown;
  totalOutstandingCents: number;
}

/**
 * Detailed statement for ONE merchant — powers the detail page + the
 * email statement. Uses a stable `asOf` timestamp so email + UI show
 * the same aging even if it's viewed a minute later.
 */
export async function loadMerchantStatement(
  supplierTenantId: string,
  merchantTenantId: string,
  asOf: Date = new Date()
): Promise<MerchantStatement | null> {
  const [profile, supplierTenant, merchantTenant] = await Promise.all([
    prisma.supplierProfile.findUnique({
      where: { supplierTenantId },
      select: { defaultNetTermsDays: true, currency: true, displayName: true },
    }),
    prisma.tenant.findUnique({
      where: { id: supplierTenantId },
      select: { name: true, currency: true },
    }),
    prisma.tenant.findUnique({
      where: { id: merchantTenantId },
      select: { name: true },
    }),
  ]);

  // Owner email lookup — TENANT_OWNER first, fall back to any active
  // membership. Mirrors the pattern in marketplace-notify.ts so
  // "who gets the email" is consistent across the two systems.
  const ownerMembership = merchantTenant
    ? await prisma.membership.findFirst({
        where: {
          tenantId: merchantTenantId,
          role: "TENANT_OWNER",
          status: "ACTIVE",
        },
        select: { email: true },
        orderBy: { createdAt: "asc" },
      })
    : null;
  const fallbackMembership =
    !ownerMembership && merchantTenant
      ? await prisma.membership.findFirst({
          where: { tenantId: merchantTenantId, status: "ACTIVE" },
          select: { email: true },
          orderBy: { createdAt: "asc" },
        })
      : null;
  const merchantEmail = ownerMembership?.email ?? fallbackMembership?.email ?? null;

  if (!supplierTenant || !merchantTenant) return null;

  const netTermsDays = profile?.defaultNetTermsDays ?? 30;
  const currency = profile?.currency ?? supplierTenant.currency ?? "CAD";

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      supplierTenantId,
      merchantTenantId,
      status: { not: "CANCELLED" },
      paymentStatus: { not: "PAID" },
    },
    select: {
      id: true,
      poNumber: true,
      submittedAt: true,
      totalCents: true,
      paidAmountCents: true,
      currency: true,
      status: true,
      paymentStatus: true,
    },
    orderBy: { submittedAt: "asc" },
  });

  const now = asOf.getTime();
  const lines: StatementLine[] = [];
  const aging = emptyAging();
  let total = 0;

  for (const po of pos) {
    const outstanding = po.totalCents - (po.paidAmountCents ?? 0);
    if (outstanding <= 0) continue;
    const dueDate = new Date(po.submittedAt.getTime() + netTermsDays * MS_PER_DAY);
    const daysOverdue = Math.floor((now - dueDate.getTime()) / MS_PER_DAY);
    const bucket = ageBucket(daysOverdue);
    lines.push({
      poId: po.id,
      poNumber: po.poNumber,
      submittedAt: po.submittedAt,
      dueDate,
      daysOverdue,
      bucket,
      totalCents: po.totalCents,
      paidAmountCents: po.paidAmountCents ?? 0,
      outstandingCents: outstanding,
      status: po.status,
      paymentStatus: po.paymentStatus,
      currency: po.currency,
    });
    aging[bucket] += outstanding;
    total += outstanding;
  }

  return {
    merchantTenantId,
    merchantName: merchantTenant.name,
    merchantEmail,
    supplierName: profile?.displayName || supplierTenant.name,
    netTermsDays,
    currency,
    asOf,
    lines,
    aging,
    totalOutstandingCents: total,
  };
}

// Convenience export for UI consumers that need the bucket order for
// consistent labeling.
export const AGING_BUCKET_ORDER = BUCKETS;
