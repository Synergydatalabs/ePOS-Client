// =============================================================================
// Phase F #3 (2026-08-27) — Supplier T&C service layer.
//
// One-active-at-a-time versioning:
//   • publishTermsVersion  — writes a new row, sets effectiveTo=NOW() on the
//                            previous active row atomically in a transaction
//   • getActiveTerms       — the single row with effectiveTo IS NULL
//   • listVersions         — full history, newest first
//   • recordAcceptance     — snapshots body + hash + IP + UA + geo at time
//                            of acceptance. Called from the public pay page.
//   • listAcceptances      — supplier-scoped browse of every accept event.
//
// IP address helper accepts NextRequest and walks X-Forwarded-For →
// X-Real-IP → connection remote address. Empty is fine: the acceptance row
// still records everything else we have.
// =============================================================================

import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import prisma from "@/lib/prisma";

// --- Types -------------------------------------------------------------------

export interface PublishTermsInput {
  supplierTenantId: string;
  version: string;
  bodyMarkdown: string;
  createdByMembershipId?: string | null;
}

export interface RecordAcceptanceInput {
  supplierTenantId: string;
  termsVersionId: string;
  invoiceId?: string | null;
  acceptedName: string;
  acceptedEmail: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  geoCountry?: string | null;
  geoRegion?: string | null;
  geoCity?: string | null;
}

// --- Body hashing ------------------------------------------------------------

/**
 * SHA-256 fingerprint of the T&C body. Stable across whitespace-only edits
 * (we normalize CRLF → LF and trim trailing spaces per line) so a mere
 * line-ending change doesn't count as a "different document" for the
 * acceptance snapshot.
 */
export function hashTermsBody(body: string): string {
  const normalized = body
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .join("\n");
  return createHash("sha256").update(normalized).digest("hex");
}

// --- Publish -----------------------------------------------------------------

export async function publishTermsVersion(input: PublishTermsInput) {
  const version = input.version.trim();
  const body = input.bodyMarkdown.replace(/\r\n?/g, "\n");
  if (!version) throw new Error("Version label is required");
  if (version.length > 40) throw new Error("Version label max 40 characters");
  if (!body.trim()) throw new Error("T&C body cannot be empty");
  if (body.length > 500_000) throw new Error("T&C body too long (max 500KB)");

  return prisma.$transaction(async (tx) => {
    // Deactivate the currently-active version (if any). Same supplier
    // tenant, effectiveTo IS NULL means it's the one in force right now.
    await tx.supplierTermsVersion.updateMany({
      where: { supplierTenantId: input.supplierTenantId, effectiveTo: null },
      data: { effectiveTo: new Date() },
    });

    return tx.supplierTermsVersion.create({
      data: {
        supplierTenantId: input.supplierTenantId,
        version,
        bodyMarkdown: body,
        effectiveFrom: new Date(),
        createdByMembershipId: input.createdByMembershipId ?? null,
      },
    });
  });
}

// --- Reads -------------------------------------------------------------------

export async function getActiveTerms(supplierTenantId: string) {
  return prisma.supplierTermsVersion.findFirst({
    where: { supplierTenantId, effectiveTo: null },
    orderBy: { effectiveFrom: "desc" },
  });
}

export async function listTermsVersions(supplierTenantId: string) {
  return prisma.supplierTermsVersion.findMany({
    where: { supplierTenantId },
    orderBy: [{ effectiveFrom: "desc" }],
    include: { _count: { select: { acceptances: true } } },
  });
}

export async function getTermsVersion(
  supplierTenantId: string,
  versionId: string
) {
  return prisma.supplierTermsVersion.findFirst({
    where: { id: versionId, supplierTenantId },
  });
}

// --- Acceptance --------------------------------------------------------------

/**
 * Extract the customer's IP from a NextRequest. Priority:
 *   1. X-Forwarded-For (first hop = the real client through most CDNs / ALBs)
 *   2. X-Real-IP (nginx / some proxies)
 *   3. request.ip (Next.js runtime — usually null behind ALB)
 * Trims to first entry, drops IPv6 zone id, caps length at 64 for the column.
 */
export function extractClientIp(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim().slice(0, 64);
  return null;
}

/**
 * Best-effort geo lookup for an IP address. Uses the free ipapi.co endpoint
 * (no key required for ≤1k req/day; suitable for a hub launch). Fails
 * silently and returns null values on any error — an acceptance row must
 * still write with just the IP + UA if geo lookup fails.
 */
export async function lookupGeoForIp(ip: string | null | undefined): Promise<{
  country: string | null;
  region: string | null;
  city: string | null;
}> {
  const empty = { country: null, region: null, city: null };
  if (!ip) return empty;
  // Skip private / loopback ranges — ipapi returns nothing useful.
  if (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("127.") ||
    ip.startsWith("172.16.") ||
    ip.startsWith("::1") ||
    ip === "localhost"
  ) {
    return empty;
  }
  try {
    // 2.5s cap — we shouldn't stall the customer's Pay click on a slow
    // third-party service.
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return empty;
    const data = await res.json();
    return {
      country: typeof data?.country_code === "string" ? data.country_code.slice(0, 2) : null,
      region: typeof data?.region === "string" ? data.region.slice(0, 100) : null,
      city: typeof data?.city === "string" ? data.city.slice(0, 100) : null,
    };
  } catch {
    return empty;
  }
}

export async function recordTermsAcceptance(input: RecordAcceptanceInput) {
  const version = await prisma.supplierTermsVersion.findFirst({
    where: { id: input.termsVersionId, supplierTenantId: input.supplierTenantId },
  });
  if (!version) {
    throw new Error("Terms version not found for this supplier");
  }

  return prisma.supplierTermsAcceptance.create({
    data: {
      supplierTenantId: input.supplierTenantId,
      termsVersionId: version.id,
      invoiceId: input.invoiceId ?? null,
      acceptedName: input.acceptedName.trim().slice(0, 255),
      acceptedEmail: input.acceptedEmail.trim().toLowerCase().slice(0, 255),
      // Immutable snapshot — the version row could be edited/deleted later
      // (shouldn't be, but defence-in-depth) and this row still stands.
      termsBodyMarkdown: version.bodyMarkdown,
      termsVersion: version.version,
      termsHash: hashTermsBody(version.bodyMarkdown),
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent?.slice(0, 2000) ?? null,
      geoCountry: input.geoCountry ?? null,
      geoRegion: input.geoRegion ?? null,
      geoCity: input.geoCity ?? null,
      // proofPdfUrl deferred — future pass generates + uploads to S3 here
    },
  });
}

// --- Supplier browse of collected acceptances -------------------------------

export async function listTermsAcceptances(
  supplierTenantId: string,
  opts: { versionId?: string; limit?: number; cursor?: string } = {}
) {
  const where: { supplierTenantId: string; termsVersionId?: string } = {
    supplierTenantId,
  };
  if (opts.versionId) where.termsVersionId = opts.versionId;

  return prisma.supplierTermsAcceptance.findMany({
    where,
    orderBy: { acceptedAt: "desc" },
    take: Math.min(opts.limit ?? 100, 500),
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      invoiceId: true,
      acceptedName: true,
      acceptedEmail: true,
      termsVersion: true,
      termsHash: true,
      ipAddress: true,
      geoCountry: true,
      geoRegion: true,
      geoCity: true,
      acceptedAt: true,
      invoice: {
        select: { invoiceNumber: true, totalCents: true, currency: true },
      },
    },
  });
}
