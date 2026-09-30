// GET /api/mobile/products/[productId]/image
//
// Public image proxy. The mobile menu response used to embed product
// images as inline `data:image/jpeg;base64,…` URIs (see the "External
// URL or inline base64 data URL" comment on Product.imageUrl in
// schema.prisma). Coil on Android chokes on multi-KB data URIs, and
// shipping large base64 blobs inside every menu JSON is wasteful anyway.
//
// This route decodes the base64 blob once server-side and streams real
// image bytes back — Coil loads them as any other URL, HTTP caches
// them, and payload for GET /api/mobile/menu drops to <1KB per product.
//
// Auth: intentionally PUBLIC. Product images are already visible on
// the tenant's customer-facing QR menu, and gating behind a Bearer
// header would require Coil to run through our OkHttp interceptor.
// The productId is a UUID (not enumerable) and the response is the
// image bytes only — no product metadata leaks.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

// 30-day cache — images almost never change and the URL is UUID-scoped.
// Merchant edits an image → we could bust by appending ?v= to the menu
// response URL, but that's a Phase-2 optimization; for now the CDN just
// takes the hit on stale reads for a few minutes.
const CACHE_HEADER = "public, max-age=2592000, immutable";

const DATA_URI_RE = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  const { productId } = await params;

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { imageUrl: true, isActive: true },
  });

  if (!product || !product.isActive || !product.imageUrl) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const raw = product.imageUrl.trim();

  // Case 1: base64 data URI — decode and stream bytes.
  const match = raw.match(DATA_URI_RE);
  if (match) {
    const [, contentType, base64] = match;
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, "base64");
    } catch {
      return NextResponse.json({ error: "Corrupt image data" }, { status: 500 });
    }
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.length),
        "Cache-Control": CACHE_HEADER,
      },
    });
  }

  // Case 2: external URL — 302 to it. Lets Coil follow the real host
  // (S3, cdn.oreugo.ca, etc.) without us proxying bytes we don't need to.
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return NextResponse.redirect(raw, 302);
  }

  return NextResponse.json({ error: "Unsupported image format" }, { status: 500 });
}
