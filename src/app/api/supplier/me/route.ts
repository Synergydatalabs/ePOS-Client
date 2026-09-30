// GET  /api/supplier/me — current supplier's tenant + profile
// PUT  /api/supplier/me — update the profile (basic fields for Phase A)
//
// Auth: partner JWT cookie. We infer the supplier from the token's tenantId
// rather than accepting a tenantId in the URL — no risk of one supplier
// editing another's data.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";

async function requireSupplierSession(request: NextRequest) {
  const session = await getPartnerSession(request);
  if (!session) return { ok: false as const, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { id: true, businessType: true, name: true, currency: true, timezone: true },
  });
  if (!tenant || tenant.businessType !== "supplier") {
    return { ok: false as const, response: NextResponse.json({ error: "Not a supplier tenant" }, { status: 403 }) };
  }

  return { ok: true as const, session, tenant };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSupplierSession(request);
    if (!auth.ok) return auth.response;

    const profile = await prisma.supplierProfile.findUnique({
      where: { tenantId: auth.tenant.id },
    });

    // Phase H #5 (2026-09-02): also load TenantSettings so the settings
    // page can render the default currency + tax config. Row is created
    // lazily — Tenant has one at signup but old tenants may not.
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: auth.tenant.id },
      select: { taxEnabled: true, taxRate: true, taxLabel: true },
    });

    // Counts for the dashboard tiles. Kept as one grouped call so the
    // dashboard renders in a single round-trip. Zero for now, will show
    // real numbers once catalog/orders arrive in later phases.
    const [customerCount, invitesFromMerchants] = await Promise.all([
      prisma.supplierMerchantRelationship.count({
        where: { supplierTenantId: auth.tenant.id, status: "ACTIVE" },
      }),
      // If ever we let suppliers see who invited them, this is where we'd
      // include the source-of-truth link.
      Promise.resolve(0),
    ]);

    return NextResponse.json({
      success: true,
      tenant: {
        id: auth.tenant.id,
        name: auth.tenant.name,
        currency: auth.tenant.currency,
        timezone: auth.tenant.timezone,
      },
      profile,
      // Phase H #5: tax defaults surfaced for the settings page + the
      // invoice modal (which uses them to auto-calc tax on open).
      taxSettings: settings
        ? {
            taxEnabled: settings.taxEnabled,
            taxRate: Number(settings.taxRate),
            taxLabel: settings.taxLabel,
          }
        : { taxEnabled: true, taxRate: 13, taxLabel: "HST" },
      stats: {
        activeCustomers: customerCount,
        pendingInvites: invitesFromMerchants,
      },
    });
  } catch (error: any) {
    console.error("[SUPPLIER-ME] GET error:", error);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireSupplierSession(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();

    // Whitelist the editable fields. onboardingStatus + isPublic aren't in
    // here — the funnel is driven by portal actions (upload catalog etc.),
    // not manual editing, and we don't want a supplier flipping the public
    // toggle before their catalog is set up. Both come in Phase B.
    const data: Record<string, unknown> = {};
    if (typeof body.legalName === "string") data.legalName = body.legalName.trim() || null;
    if (typeof body.displayName === "string") data.displayName = body.displayName.trim() || null;
    if (typeof body.websiteUrl === "string") data.websiteUrl = body.websiteUrl.trim() || null;
    if (typeof body.contactEmail === "string") data.contactEmail = body.contactEmail.trim() || null;
    if (typeof body.contactPhone === "string") data.contactPhone = body.contactPhone.trim() || null;
    if (typeof body.aboutText === "string") data.aboutText = body.aboutText.trim() || null;
    if (Array.isArray(body.categories)) {
      data.categories = body.categories
        .map((c: unknown) => String(c).trim())
        .filter(Boolean)
        .slice(0, 20);
    }
    if (typeof body.minOrderCents === "number" && body.minOrderCents >= 0) {
      data.minOrderCents = Math.round(body.minOrderCents);
    }
    if (typeof body.defaultLeadDays === "number" && body.defaultLeadDays >= 0) {
      data.defaultLeadDays = Math.round(body.defaultLeadDays);
    }
    // Phase D #75: Net-terms days for AR aging. Cap at 180 to catch typos.
    if (
      typeof body.defaultNetTermsDays === "number" &&
      body.defaultNetTermsDays >= 0 &&
      body.defaultNetTermsDays <= 180
    ) {
      data.defaultNetTermsDays = Math.round(body.defaultNetTermsDays);
    }
    if (body.warehouseAddress && typeof body.warehouseAddress === "object") {
      data.warehouseAddress = body.warehouseAddress;
    }

    // Phase H #5 (2026-09-02): tenant-level defaults for invoicing.
    // `currency` lives on Tenant; `taxRate` / `taxLabel` / `taxEnabled`
    // live on TenantSettings (per-tenant one-row config table). Both
    // are updated in the same request but write to different tables.
    let currencyUpdate: string | null = null;
    if (typeof body.currency === "string" && body.currency.trim()) {
      currencyUpdate = body.currency.trim().toUpperCase().slice(0, 3);
    }
    const taxUpdate: {
      taxEnabled?: boolean;
      taxRate?: number;
      taxLabel?: string;
    } = {};
    if (typeof body.taxEnabled === "boolean") taxUpdate.taxEnabled = body.taxEnabled;
    if (typeof body.taxRate === "number" && body.taxRate >= 0 && body.taxRate <= 100) {
      taxUpdate.taxRate = Math.round(body.taxRate * 100) / 100; // 2 dp
    }
    if (typeof body.taxLabel === "string" && body.taxLabel.trim()) {
      taxUpdate.taxLabel = body.taxLabel.trim().slice(0, 20);
    }

    if (
      Object.keys(data).length === 0 &&
      !currencyUpdate &&
      Object.keys(taxUpdate).length === 0
    ) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }

    // SupplierProfile — only when there's actually something to change.
    const profile = Object.keys(data).length > 0
      ? await prisma.supplierProfile.update({
          where: { tenantId: auth.tenant.id },
          data,
        })
      : await prisma.supplierProfile.findUnique({
          where: { tenantId: auth.tenant.id },
        });

    // Tenant currency lives on the Tenant row; SupplierProfile also
    // stores a copy. Update both so the two can never drift — the
    // settings page reads from profile.currency, invoice modal reads
    // from tenant.currency, both flip together.
    if (currencyUpdate) {
      await prisma.$transaction([
        prisma.tenant.update({
          where: { id: auth.tenant.id },
          data: { currency: currencyUpdate },
        }),
        prisma.supplierProfile.update({
          where: { tenantId: auth.tenant.id },
          data: { currency: currencyUpdate },
        }),
      ]);
    }

    // TenantSettings — upsert so the row is created for older tenants
    // that pre-date the settings table. Only writes the tax columns that
    // actually changed (partial update).
    let taxSettings: {
      taxEnabled: boolean;
      taxRate: number;
      taxLabel: string;
    } | null = null;
    if (Object.keys(taxUpdate).length > 0) {
      const upserted = await prisma.tenantSettings.upsert({
        where: { tenantId: auth.tenant.id },
        create: {
          tenantId: auth.tenant.id,
          taxEnabled: taxUpdate.taxEnabled ?? true,
          taxRate: taxUpdate.taxRate ?? 13,
          taxLabel: taxUpdate.taxLabel ?? "HST",
        },
        update: taxUpdate,
        select: { taxEnabled: true, taxRate: true, taxLabel: true },
      });
      taxSettings = {
        taxEnabled: upserted.taxEnabled,
        taxRate: Number(upserted.taxRate),
        taxLabel: upserted.taxLabel,
      };
    }

    return NextResponse.json({
      success: true,
      profile,
      currency: currencyUpdate ?? auth.tenant.currency,
      taxSettings,
    });
  } catch (error: any) {
    console.error("[SUPPLIER-ME] PUT error:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
