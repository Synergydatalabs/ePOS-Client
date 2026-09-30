// POST /api/supplier/invoices/[invoiceId]/send-email — re-send the invoice
// email to the customer. Supplier-scoped. Refuses on cancelled invoices;
// records emailSentAt (or emailFailedReason) on the row so the UI can badge
// the state.
//
// Same rendering path as the initial send in POST /api/supplier/invoices;
// this endpoint is here because the supplier might want to resend after a
// customer says "I never got the email", or after fixing a typo'd email
// address on the row (future — PATCH endpoint).

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { getSupplierInvoice, resolveInvoiceVendor } from "@/lib/supplier-invoices";
import { sendSupplierInvoiceEmail } from "@/lib/email";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;

  const { invoiceId } = await params;
  const invoice = await getSupplierInvoice(auth.tenant.id, invoiceId);
  if (!invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (invoice.status === "CANCELLED") {
    return NextResponse.json(
      { error: "Cancelled invoices cannot be resent" },
      { status: 409 }
    );
  }
  if (!invoice.paymentLinkUrl) {
    return NextResponse.json(
      { error: "This invoice has no payment link — cannot email" },
      { status: 500 }
    );
  }

  // Phase F #6k (2026-08-28): resend supports overriding the recipient +
  // extra CCs. If nothing is passed we fall back to what's stored on the
  // invoice row (original send behaviour). Override is one-off: not
  // persisted to the row, since it's often a "send this to a specific
  // person" ad-hoc action rather than a permanent change.
  let body: { overrideEmail?: string; overrideCc?: string[] } = {};
  try {
    body = await request.json();
  } catch {
    // No body — fine, use defaults.
  }
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const overrideEmail = typeof body.overrideEmail === "string" && body.overrideEmail.trim()
    ? body.overrideEmail.trim().toLowerCase()
    : null;
  if (overrideEmail && !emailRe.test(overrideEmail)) {
    return NextResponse.json({ error: "Override email is not a valid address" }, { status: 400 });
  }
  const overrideCc = Array.isArray(body.overrideCc)
    ? body.overrideCc
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => emailRe.test(e))
    : null;
  const toEmail = overrideEmail || invoice.customerEmail;
  const ccEmails = overrideCc !== null ? overrideCc : (invoice.customerCcEmails || []);

  try {
    const supplier = await prisma.tenant.findUnique({
      where: { id: auth.tenant.id },
      select: {
        name: true,
        supplierProfile: { select: { displayName: true, contactEmail: true } },
        settings: { select: { brandName: true, brandPrimaryColor: true } },
      },
    });
    const displayName =
      supplier?.supplierProfile?.displayName ||
      supplier?.settings?.brandName ||
      supplier?.name ||
      "hub";
    // #G1: pull the subscription (if any) so the resend email carries the
    // "Cancel subscription" link. `invoice` from getSupplierInvoice doesn't
    // include the sub relation, so one cheap join here.
    const invSub = invoice.subscriptionId
      ? await prisma.supplierSubscription.findUnique({
          where: { id: invoice.subscriptionId },
          select: { cancelToken: true, interval: true },
        })
      : null;
    const invOrigin = new URL(invoice.paymentLinkUrl).origin;

    await sendSupplierInvoiceEmail({
      to: toEmail,
      cc: ccEmails,
      supplierDisplayName: displayName,
      supplierContactEmail: supplier?.supplierProfile?.contactEmail || null,
      invoiceNumber: invoice.invoiceNumber,
      totalCents: invoice.totalCents,
      currency: invoice.currency,
      itemCount: invoice.items.length,
      paymentLinkUrl: invoice.paymentLinkUrl,
      brandPrimaryColor: supplier?.settings?.brandPrimaryColor || null,
      notes: invoice.notes,
      // #6u: vendor branding — swaps email to Deep Navy + Electric Blue
      // when the invoice's product carries a vendor.
      vendor: resolveInvoiceVendor(invoice.items),
      subscription:
        invSub && invoice.subscriptionSequence
          ? {
              sequence: invoice.subscriptionSequence,
              interval: invSub.interval,
              cancelUrl: `${invOrigin}/subscriptions/${invSub.cancelToken}/cancel`,
            }
          : null,
    });
    await prisma.supplierInvoice.update({
      where: { id: invoice.id },
      data: { emailSentAt: new Date(), emailFailedReason: null },
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    const message =
      (err?.name || "Error") + ": " + String(err?.message || err).slice(0, 500);
    await prisma.supplierInvoice
      .update({ where: { id: invoice.id }, data: { emailFailedReason: message } })
      .catch(() => {});
    console.error("[SUPPLIER-INVOICES] resend failed:", err);
    return NextResponse.json(
      { error: "Email failed. See server logs. You can still share the payment link manually." },
      { status: 500 }
    );
  }
}
