// GET /api/partner/branding - Public: resolve branding from hostname or slug
// PUT /api/partner/branding - Authenticated: update branding settings
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import { resolveTenant, invalidateTenantCache } from "@/lib/tenant-resolver";

export async function GET(request: NextRequest) {
  try {
    const hostname = request.headers.get("host") || "";
    const slug = request.nextUrl.searchParams.get("slug");

    let settings = null;

    if (slug) {
      // Resolve by slug
      const tenant = await prisma.tenant.findUnique({
        where: { slug },
        include: { settings: true },
      });
      if (tenant?.settings) {
        settings = {
          tenantName: tenant.name,
          brandName: tenant.settings.brandName,
          brandLogoUrl: tenant.settings.brandLogoUrl,
          brandFaviconUrl: tenant.settings.brandFaviconUrl,
          brandPrimaryColor: tenant.settings.brandPrimaryColor,
          brandAccentColor: tenant.settings.brandAccentColor,
          brandBackgroundColor: tenant.settings.brandBackgroundColor,
          poweredByVisible: tenant.settings.poweredByVisible,
        };
      }
    } else {
      // Resolve by hostname
      const resolved = await resolveTenant(hostname);
      if (resolved) {
        settings = {
          tenantName: resolved.name,
          ...resolved.branding,
        };
      }
    }

    if (!settings) {
      // Platform default — used when a host resolves to no tenant (e.g. the
      // canonical iTap platform domain itap.synergydatalabs.com). Palette
      // matches the datanova Synergy Data Labs marketing site
      // (C:\Mod App\SDL\datanova-1.0.0): teal primary, deeper teal accent,
      // near-white background. Keeping this in sync with ItapShell means the
      // brief pre-hydration paint and any downstream inline usage of
      // --brand-primary stay teal instead of flashing the old iTap purple.
      return NextResponse.json({
        success: true,
        branding: {
          tenantName: "iTap",
          brandName: "iTap",
          brandLogoUrl: "/images/logo/itap-wordmark.png",
          brandFaviconUrl: "/images/logo/itap-icon-192.png",
          brandPrimaryColor: "#0F766E",
          brandAccentColor: "#14B8A6",
          brandBackgroundColor: "#FFFFFF",
          poweredByVisible: false,
        },
      });
    }

    return NextResponse.json({ success: true, branding: settings });
  } catch (error: any) {
    console.error("[PARTNER] Branding GET error:", error);
    return NextResponse.json(
      { error: "Failed to load branding", detail: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only owners can update branding
    if (session.role !== "TENANT_OWNER") {
      return NextResponse.json(
        { error: "Only the account owner can update branding" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      brandName,
      brandLogoUrl,
      brandFaviconUrl,
      brandPrimaryColor,
      brandAccentColor,
      brandBackgroundColor,
      poweredByVisible,
      customDomain,
    } = body;

    // Validate hex colors if provided
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    if (brandPrimaryColor && !hexRegex.test(brandPrimaryColor)) {
      return NextResponse.json({ error: "Invalid primary color format" }, { status: 400 });
    }
    if (brandAccentColor && !hexRegex.test(brandAccentColor)) {
      return NextResponse.json({ error: "Invalid accent color format" }, { status: 400 });
    }
    if (brandBackgroundColor && !hexRegex.test(brandBackgroundColor)) {
      return NextResponse.json({ error: "Invalid background color format" }, { status: 400 });
    }

    // If custom domain is being set, check uniqueness
    if (customDomain) {
      const existing = await prisma.tenantSettings.findFirst({
        where: {
          customDomain: customDomain.toLowerCase(),
          tenantId: { not: session.tenantId },
        },
      });
      if (existing) {
        return NextResponse.json(
          { error: "This domain is already in use" },
          { status: 409 }
        );
      }
    }

    // Build update data (only provided fields)
    const updateData: Record<string, unknown> = {};
    if (brandName !== undefined) updateData.brandName = brandName;
    if (brandLogoUrl !== undefined) updateData.brandLogoUrl = brandLogoUrl;
    if (brandFaviconUrl !== undefined) updateData.brandFaviconUrl = brandFaviconUrl;
    if (brandPrimaryColor !== undefined) updateData.brandPrimaryColor = brandPrimaryColor;
    if (brandAccentColor !== undefined) updateData.brandAccentColor = brandAccentColor;
    if (brandBackgroundColor !== undefined) updateData.brandBackgroundColor = brandBackgroundColor;
    if (poweredByVisible !== undefined) updateData.poweredByVisible = poweredByVisible;
    if (customDomain !== undefined) updateData.customDomain = customDomain?.toLowerCase() || null;

    const updated = await prisma.tenantSettings.update({
      where: { tenantId: session.tenantId },
      data: updateData,
      select: {
        brandName: true,
        brandLogoUrl: true,
        brandFaviconUrl: true,
        brandPrimaryColor: true,
        brandAccentColor: true,
        brandBackgroundColor: true,
        poweredByVisible: true,
        customDomain: true,
      },
    });

    // Invalidate cache
    invalidateTenantCache();

    return NextResponse.json({ success: true, branding: updated });
  } catch (error: any) {
    console.error("[PARTNER] Branding PUT error:", error);
    return NextResponse.json(
      { error: "Failed to update branding" },
      { status: 500 }
    );
  }
}
