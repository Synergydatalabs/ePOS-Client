// GET /api/platform/gateway-applications
// Lists ALL applications across every supplier tenant. Guarded by
// requirePlatformAdmin() — email allowlist via PLATFORM_ADMIN_EMAILS env var.
//
// Query params:
//   ?status=SUBMITTED    — filter by status
//   ?search=xyz          — matches legalName / dbaName / supplier tenant name
//
// Never returns decrypted PII on the list endpoint — that's the detail
// endpoint's job. This is the queue view, kept lightweight.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platform-admin";

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformAdmin(request);
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const search = searchParams.get("search")?.trim();

    // Scoped to SUPPLIER role — this legacy tap-app queue only shows the
    // supplier-side pipeline. The merchant-side queue lives in tapapp-admin
    // (Phase 2b).
    const where: any = { tenantRole: "SUPPLIER" };
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { legalName: { contains: search, mode: "insensitive" } },
        { dbaName: { contains: search, mode: "insensitive" } },
        { tenant: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const applications = await prisma.merchantApplication.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      take: 200,
      select: {
        id: true,
        status: true,
        targetProcessor: true,
        legalName: true,
        dbaName: true,
        businessTypeName: true,
        incorporationRegion: true,
        projectedMonthlyVolumeCents: true,
        currency: true,
        submittedAt: true,
        forwardedAt: true,
        approvedAt: true,
        rejectedAt: true,
        infoRequestedAt: true,
        lastAdminActionAt: true,
        reviewedByAdminEmail: true,
        forwardedToEmail: true,
        signerEmail: true,
        tenant: {
          select: {
            id: true,
            name: true,
            supplierProfile: {
              select: { displayName: true, contactEmail: true, contactPhone: true },
            },
          },
        },
      },
    });

    // Status counts for the queue tabs — always shows the FULL total,
    // not filtered by the current query, so tab badges are stable.
    const rawCounts = await prisma.merchantApplication.groupBy({
      by: ["status"],
      where: { tenantRole: "SUPPLIER" },
      _count: true,
    });
    const counts = Object.fromEntries(rawCounts.map((c) => [c.status, c._count]));

    return NextResponse.json({
      success: true,
      applications: applications.map((a) => ({
        ...a,
        supplierName: a.tenant.supplierProfile?.displayName || a.tenant.name,
        supplierContactEmail: a.tenant.supplierProfile?.contactEmail || a.signerEmail,
        // Preserve the legacy field name the client expects so this
        // endpoint stays API-compatible with the existing UI.
        supplierTenant: { id: a.tenant.id },
      })),
      counts,
    });
  } catch (error: any) {
    console.error("[PLATFORM-APPS] GET error:", error);
    return NextResponse.json({ error: "Failed to load applications" }, { status: 500 });
  }
}
