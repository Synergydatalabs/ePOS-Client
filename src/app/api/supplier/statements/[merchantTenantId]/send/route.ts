// POST /api/supplier/statements/[merchantTenantId]/send
// Emails an AR statement to the merchant. Uses the merchant's owner email
// by default; supplier can override with `to` in the body (e.g. AP contact).

import { NextRequest, NextResponse } from "next/server";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { loadMerchantStatement } from "@/lib/marketplace-ar-aging";
import { sendStatementEmail } from "@/lib/email";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ merchantTenantId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { merchantTenantId } = await params;

    const body = await request.json().catch(() => ({}));
    const overrideTo =
      typeof body?.to === "string" && body.to.trim() ? body.to.trim() : null;
    const extraNote =
      typeof body?.note === "string" && body.note.trim() ? body.note.trim() : undefined;

    const statement = await loadMerchantStatement(auth.tenant.id, merchantTenantId);
    if (!statement) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }
    if (statement.totalOutstandingCents <= 0) {
      return NextResponse.json(
        { error: "This merchant has no outstanding balance — nothing to send." },
        { status: 400 }
      );
    }

    const to = overrideTo || statement.merchantEmail;
    if (!to) {
      return NextResponse.json(
        {
          error:
            "No merchant email on file. Enter one in the send form to override.",
        },
        { status: 400 }
      );
    }

    await sendStatementEmail({
      to,
      merchantName: statement.merchantName,
      supplierName: statement.supplierName,
      currency: statement.currency,
      asOf: statement.asOf,
      netTermsDays: statement.netTermsDays,
      totalOutstandingCents: statement.totalOutstandingCents,
      aging: statement.aging,
      lines: statement.lines.map((l) => ({
        poNumber: l.poNumber,
        submittedAt: l.submittedAt,
        dueDate: l.dueDate,
        daysOverdue: l.daysOverdue,
        totalCents: l.totalCents,
        paidAmountCents: l.paidAmountCents,
        outstandingCents: l.outstandingCents,
      })),
      merchantPortalUrl: `${BASE_URL}/dashboard/admin/marketplace/orders`,
      extraNote,
    });

    return NextResponse.json({ success: true, sentTo: to });
  } catch (error: any) {
    console.error("[SUPPLIER-STATEMENT-SEND] error:", error);
    return NextResponse.json(
      { error: "Failed to send statement" },
      { status: 500 }
    );
  }
}
