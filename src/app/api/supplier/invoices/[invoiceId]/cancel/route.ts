// POST /api/supplier/invoices/[invoiceId]/cancel — soft-cancel an invoice.
// Refuses if the invoice is already PAID (issue a refund via processor
// instead — the service layer throws with that message and we bubble it up).

import { NextRequest, NextResponse } from "next/server";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { cancelSupplierInvoice } from "@/lib/supplier-invoices";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;

  const { invoiceId } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const reason = typeof body?.reason === "string" ? body.reason : null;

    const cancelled = await cancelSupplierInvoice(
      auth.tenant.id,
      invoiceId,
      auth.session.memberId,
      reason
    );
    if (!cancelled) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, invoice: cancelled });
  } catch (err: any) {
    console.error("[SUPPLIER-INVOICES] cancel error:", err);
    const message = typeof err?.message === "string" ? err.message : "Failed to cancel invoice";
    const status = /paid invoice|refund/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
