// GET  /api/supplier/terms   — list every T&C version this supplier has published
// POST /api/supplier/terms   — publish a new version (auto-deactivates the previous)

import { NextRequest, NextResponse } from "next/server";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { listTermsVersions, publishTermsVersion } from "@/lib/supplier-terms";

export async function GET(request: NextRequest) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const versions = await listTermsVersions(auth.tenant.id);
    return NextResponse.json({ success: true, versions });
  } catch (err: any) {
    console.error("[SUPPLIER-TERMS] list error:", err);
    return NextResponse.json({ error: "Failed to load T&C versions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const version = String(body.version || "").trim();
    const bodyMarkdown = String(body.bodyMarkdown || "");

    const published = await publishTermsVersion({
      supplierTenantId: auth.tenant.id,
      createdByMembershipId: auth.session.memberId,
      version,
      bodyMarkdown,
    });
    return NextResponse.json({ success: true, version: published });
  } catch (err: any) {
    console.error("[SUPPLIER-TERMS] publish error:", err);
    const message = typeof err?.message === "string" ? err.message : "Failed to publish T&C";
    const status =
      /required|empty|too long|max \d+ characters|Unique constraint|already/i.test(message) ||
      err?.code === "P2002"
        ? 400
        : 500;
    // Duplicate version label maps to a friendlier 409-ish 400 message.
    const clean =
      err?.code === "P2002"
        ? `Version "${(err?.meta?.target as string[] | undefined)?.join(", ") ?? ""}" already exists — pick a different label.`
        : message;
    return NextResponse.json({ error: clean }, { status });
  }
}
