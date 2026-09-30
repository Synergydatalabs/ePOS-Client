// =============================================================================
// GET /api/supplier/terms/acceptances/[acceptanceId]/download
//
// Renders a printable one-page HTML "acceptance certificate" that the
// supplier can hand to a chargeback processor or a lawyer as proof the
// customer agreed to their T&C. Ships as HTML with @media print styles so
// the supplier's browser "Save as PDF" produces a clean A4 page — no
// pdf-lib dependency required. A real server-side PDF (populating the
// schema's reserved proof_pdf_url) is deferred to a later pass.
//
// Auth: partner JWT + row must belong to this supplier's tenant. That's
// the ONLY guard — a supplier can't peek at another supplier's records
// because the query is scoped by tenant.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";

function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ acceptanceId: string }> }
) {
  try {
    const { acceptanceId } = await params;
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const tenant = await prisma.tenant.findUnique({
      where: { id: session.tenantId },
      select: { id: true, businessType: true, name: true },
    });
    if (!tenant || tenant.businessType !== "supplier") {
      return NextResponse.json({ error: "Not a supplier tenant" }, { status: 403 });
    }

    const acc = await prisma.supplierTermsAcceptance.findUnique({
      where: { id: acceptanceId },
      include: {
        invoice: {
          select: {
            invoiceNumber: true,
            totalCents: true,
            currency: true,
            sentAt: true,
          },
        },
      },
    });
    if (!acc || acc.supplierTenantId !== tenant.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const supplier = await prisma.tenant.findUnique({
      where: { id: acc.supplierTenantId },
      select: {
        name: true,
        supplierProfile: { select: { displayName: true, contactEmail: true, legalName: true } },
      },
    });
    const displayName =
      supplier?.supplierProfile?.displayName ||
      supplier?.name ||
      "Supplier";
    const legalName = supplier?.supplierProfile?.legalName || null;

    const acceptedAt = new Date(acc.acceptedAt).toISOString();
    const acceptedLocal = new Date(acc.acceptedAt).toLocaleString("en-CA", {
      dateStyle: "long",
      timeStyle: "medium",
      timeZone: "UTC",
    });

    const geoLine = [acc.geoCity, acc.geoRegion, acc.geoCountry]
      .filter(Boolean)
      .join(", ") || "—";

    const invLine = acc.invoice
      ? `Invoice ${acc.invoice.invoiceNumber} — ${acc.invoice.currency} ${(
          acc.invoice.totalCents / 100
        ).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "No invoice linked";

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>T&amp;C Acceptance ${esc(acc.id.slice(0, 8))} — ${esc(displayName)}</title>
<style>
  :root { --teal: #0F766E; --navy: #0F172A; --ink: #1f2937; --muted: #6b7280; --line: #e5e7eb; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #f8fafc; color: var(--ink); font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif; }
  .page { max-width: 780px; margin: 0 auto; padding: 32px; background: #fff; }
  .toolbar { display: flex; gap: 8px; align-items: center; justify-content: flex-end; padding: 12px 16px; background: #fff; border-bottom: 1px solid var(--line); position: sticky; top: 0; z-index: 10; }
  .toolbar button { border: 1px solid var(--teal); background: var(--teal); color: #fff; font-weight: 600; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; }
  .toolbar button.secondary { background: #fff; color: var(--teal); }
  .brand { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 2px solid var(--teal); margin-bottom: 24px; }
  .brand h1 { margin: 0; font-size: 22px; color: var(--navy); letter-spacing: -0.01em; }
  .brand .sub { color: var(--muted); font-size: 12px; margin-top: 4px; }
  .brand .cert { text-align: right; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .brand .cert strong { display: block; color: var(--navy); font-size: 14px; letter-spacing: 0; text-transform: none; margin-top: 2px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  h2 { color: var(--navy); font-size: 15px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.06em; }
  .grid { display: grid; grid-template-columns: 180px 1fr; gap: 6px 16px; margin: 0 0 20px; }
  .grid dt { color: var(--muted); font-weight: 500; }
  .grid dd { margin: 0; color: var(--ink); }
  .grid dd.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
  .attest { border: 1px solid var(--line); background: #f9fafb; padding: 16px 18px; border-radius: 8px; margin: 20px 0; font-size: 13px; color: var(--ink); }
  .attest strong { color: var(--navy); }
  .terms-body { border: 1px solid var(--line); padding: 20px; border-radius: 8px; white-space: pre-wrap; font-size: 12.5px; line-height: 1.6; color: #374151; max-height: none; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--line); font-size: 11px; color: var(--muted); display: flex; justify-content: space-between; align-items: center; }
  .footer .hash { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .page { max-width: none; padding: 20mm; box-shadow: none; }
    @page { size: A4; margin: 0; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <button class="secondary" onclick="window.close()">Close</button>
    <button onclick="window.print()">Save as PDF</button>
  </div>
  <div class="page">
    <div class="brand">
      <div>
        <h1>${esc(displayName)}</h1>
        ${legalName ? `<div class="sub">${esc(legalName)}</div>` : ""}
      </div>
      <div class="cert">
        Certificate of Acceptance
        <strong>${esc(acc.id)}</strong>
      </div>
    </div>

    <h2>Signatory</h2>
    <dl class="grid">
      <dt>Full name</dt><dd>${esc(acc.acceptedName)}</dd>
      <dt>Email</dt><dd>${esc(acc.acceptedEmail)}</dd>
      <dt>IP address</dt><dd class="mono">${esc(acc.ipAddress) || "—"}</dd>
      <dt>Location</dt><dd>${esc(geoLine)}</dd>
      <dt>Browser</dt><dd class="mono" style="font-size:11px">${esc(acc.userAgent) || "—"}</dd>
    </dl>

    <h2>What they accepted</h2>
    <dl class="grid">
      <dt>Terms version</dt><dd>${esc(acc.termsVersion)}</dd>
      <dt>Terms hash (SHA-256)</dt><dd class="mono">${esc(acc.termsHash)}</dd>
      <dt>Related invoice</dt><dd>${esc(invLine)}</dd>
      <dt>Accepted at (UTC)</dt><dd>${esc(acceptedLocal)} <span style="color:var(--muted);font-size:11px">(${esc(acceptedAt)})</span></dd>
    </dl>

    <div class="attest">
      On <strong>${esc(acceptedLocal)} UTC</strong>, <strong>${esc(acc.acceptedName)}</strong>
      (${esc(acc.acceptedEmail)}) submitted an electronic acceptance of
      ${esc(displayName)}'s Terms &amp; Conditions, version
      <strong>${esc(acc.termsVersion)}</strong>. This acceptance was captured
      from IP address <strong>${esc(acc.ipAddress || "unknown")}</strong>
      via ${esc(displayName)}'s payment portal on hub.
      The full text of the terms as they existed at the moment of acceptance
      is reproduced below and its SHA-256 hash is recorded above for tamper
      evidence.
    </div>

    <h2>Terms &amp; Conditions (as accepted)</h2>
    <div class="terms-body">${esc(acc.termsBodyMarkdown)}</div>

    <div class="footer">
      <span>Generated ${esc(new Date().toISOString())}</span>
      <span class="hash">acceptance ${esc(acc.id)}</span>
    </div>
  </div>
</body>
</html>`;

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err: any) {
    console.error("[SUPPLIER-TERMS-DOWNLOAD] error:", err);
    return NextResponse.json({ error: "Failed to render certificate" }, { status: 500 });
  }
}
