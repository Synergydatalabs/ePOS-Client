// ============================================================================
// GET /api/public/tour/[slug]
//
// PUBLIC endpoint (no auth) for embedding the virtual tour on the customer
// booking page or a restaurant's own website. Returns only what's needed to
// render the tour:
//   - location name + cover photo
//   - 360° scenes (with hotspots — public-safe fields only)
//   - tables (only public-safe fields — id, number, capacity, section name)
//
// We intentionally don't include any prices, internal notes, or staff data.
// CORS-friendly so it can be embedded as iframe on any domain.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    const location = await prisma.location.findUnique({
      where: { publicTourSlug: slug },
      select: {
        id: true,
        name: true,
        publicTourSlug: true,
        tenant: { select: { name: true } },
      },
    });

    if (!location) {
      return NextResponse.json({ error: "Tour not found" }, { status: 404 });
    }

    // Load 360° scenes with hotspots
    const scenes = await prisma.mediaItem.findMany({
      where: {
        locationId: location.id,
        mediaType: "PANORAMA_360",
        isActive: true,
      },
      orderBy: [{ isDefaultScene: "desc" }, { displayOrder: "asc" }],
      select: {
        id: true,
        sceneName: true,
        publicUrl: true,
        initialYaw: true,
        initialPitch: true,
        initialFov: true,
        isDefaultScene: true,
        hotspots: {
          where: { isActive: true },
          select: {
            id: true,
            hotspotType: true,
            yaw: true,
            pitch: true,
            label: true,
            iconUrl: true,
            targetSceneMediaId: true,
            targetTableId: true,
            externalUrl: true,
            targetYaw: true,
            targetPitch: true,
          },
        },
      },
    });

    // Tables (only bookable, public-safe fields)
    const tables = await prisma.table.findMany({
      where: { locationId: location.id, isActive: true, isBookable: true },
      select: {
        id: true,
        tableNumber: true,
        displayLabel: true,
        capacity: true,
        minPartySize: true,
        maxPartySize: true,
        section: { select: { id: true, name: true, color: true } },
      },
      orderBy: { tableNumber: "asc" },
    });

    return NextResponse.json(
      {
        location: {
          id: location.id,
          name: location.name,
          slug: location.publicTourSlug,
          tenantName: location.tenant.name,
        },
        scenes,
        tables,
      },
      {
        headers: {
          // Allow iframe embedding from anywhere
          "X-Frame-Options": "ALLOWALL", // legacy; mostly ignored, CSP is what matters
          "Content-Security-Policy": "frame-ancestors *",
          // Allow CORS for fetch from other domains
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          // Cache for 60s — tour layouts don't change often
          "Cache-Control": "public, max-age=60, s-maxage=60",
        },
      }
    );
  } catch (err: any) {
    console.error("[public tour GET] error:", err);
    return NextResponse.json(
      { error: err?.message || "Failed to load tour" },
      { status: 500 }
    );
  }
}
