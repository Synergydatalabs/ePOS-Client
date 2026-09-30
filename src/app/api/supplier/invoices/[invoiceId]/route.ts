// GET /api/supplier/invoices/[invoiceId] — full detail for one invoice
//                                          (supplier-scoped by requireSupplierAuth)

import { NextRequest, NextResponse } from "next/server";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { getSupplierInvoice } from "@/lib/supplier-invoices";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;

  const { invoiceId } = await params;
  try {
    const invoice = await getSupplierInvoice(auth.tenant.id, invoiceId);
    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, invoice });
  } catch (err: any) {
    console.error("[SUPPLIER-INVOICES] detail error:", err);
    return NextResponse.json({ error: "Failed to load invoice" }, { status: 500 });
  }
}
