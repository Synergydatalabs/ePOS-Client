// GET  /api/supplier/invoices               — list invoices this supplier issued
// POST /api/supplier/invoices               — create a new invoice (draft or SENT)
//
// Query params on GET:
//   ?status=SENT|PAID|CANCELLED|REFUNDED  — filter
//   ?limit=N (default 50, max 200)
//   ?cursor=<invoiceId>                   — pagination

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { resolvePublicOrigin } from "@/lib/public-origin";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import {
  createSupplierInvoice,
  listSupplierInvoices,
  resolveInvoiceVendor,
  type InvoiceLineInput,
} from "@/lib/supplier-invoices";
import {
  createSupplierSubscription,
  type SubscriptionInterval,
} from "@/lib/supplier-subscriptions";
import { sendSupplierInvoiceEmail } from "@/lib/email";
import { notifyInvoiceCreated } from "@/lib/telegram-notify";

export async function GET(request: NextRequest) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const invoices = await listSupplierInvoices(auth.tenant.id, {
      status: searchParams.get("status") || undefined,
      limit: parseInt(searchParams.get("limit") || "50", 10) || 50,
      cursor: searchParams.get("cursor") || undefined,
    });
    return NextResponse.json({ success: true, invoices });
  } catch (err: any) {
    console.error("[SUPPLIER-INVOICES] list error:", err);
    return NextResponse.json({ error: "Failed to list invoices" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireSupplierAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    // ---- Basic validation ------------------------------------------------
    const customerName = String(body.customerName || "").trim();
    const customerEmail = String(body.customerEmail || "").trim().toLowerCase();
    if (!customerName) {
      return NextResponse.json({ error: "Customer name is required" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return NextResponse.json({ error: "A valid customer email is required" }, { status: 400 });
    }

    const rawLines = Array.isArray(body.lines) ? body.lines : [];
    if (rawLines.length === 0) {
      return NextResponse.json({ error: "At least one line item is required" }, { status: 400 });
    }
    if (rawLines.length > 100) {
      return NextResponse.json({ error: "Maximum 100 line items per invoice" }, { status: 400 });
    }

    const lines: InvoiceLineInput[] = [];
    for (let i = 0; i < rawLines.length; i++) {
      const l = rawLines[i];
      const productName = String(l?.productName || "").trim();
      const quantity = Math.round(Number(l?.quantity));
      const unitPriceCents = Math.round(Number(l?.unitPriceCents));
      if (!productName) {
        return NextResponse.json(
          { error: `Line ${i + 1}: product name is required` },
          { status: 400 }
        );
      }
      if (!Number.isFinite(quantity) || quantity < 1) {
        return NextResponse.json(
          { error: `Line ${i + 1}: quantity must be at least 1` },
          { status: 400 }
        );
      }
      if (!Number.isFinite(unitPriceCents) || unitPriceCents < 0) {
        return NextResponse.json(
          { error: `Line ${i + 1}: unit price must be a non-negative number` },
          { status: 400 }
        );
      }
      lines.push({
        productId: l?.productId || null,
        productName,
        productDescription: l?.productDescription || null,
        unitLabel: l?.unitLabel || "unit",
        quantity,
        unitPriceCents,
      });
    }

    const taxCents = Math.max(0, Math.round(Number(body.taxCents) || 0));

    // Phase F #6i (2026-08-28): canonical origin resolver, shared with the
    // Stripe checkout-session route so the two never drift. Handles env
    // preference + x-forwarded-* + legacy-host rewrite. See public-origin.ts
    // for the full preference chain.
    const origin = resolvePublicOrigin(request);

    // Phase F #6k (2026-08-28): CC emails — array from the modal. Filter
    // to strings the service layer trusts; the service also validates+dedups.
    const customerCcEmails = Array.isArray(body.customerCcEmails)
      ? body.customerCcEmails.filter((e: unknown) => typeof e === "string")
      : [];

    // Phase F #6l (2026-08-28): per-invoice currency override. Falls back
    // to the supplier tenant's default currency when the modal doesn't
    // pass one (keeps existing single-currency callers working).
    const currency = typeof body.currency === "string" && body.currency.trim()
      ? body.currency.trim().toUpperCase().slice(0, 3)
      : auth.tenant.currency;

    // Phase G #1 (2026-08-30): the invoice form now carries an optional
    // "subscription" block. When present, we mint a SupplierSubscription
    // + the first invoice atomically (createSupplierSubscription); when
    // absent, this stays a plain one-off (createSupplierInvoice). Downstream
    // email + response shape are identical either way — the invoice object
    // is what everyone consumes.
    const rawSub = body?.subscription;
    const isSubscription =
      rawSub && typeof rawSub === "object" && rawSub.enabled === true;
    let subscriptionInterval: SubscriptionInterval | null = null;
    if (isSubscription) {
      const iv = String(rawSub.interval || "").toUpperCase();
      if (iv !== "MONTHLY" && iv !== "ANNUAL") {
        return NextResponse.json(
          { error: "Subscription interval must be MONTHLY or ANNUAL" },
          { status: 400 }
        );
      }
      subscriptionInterval = iv as SubscriptionInterval;
    }

    const invoice = isSubscription && subscriptionInterval
      ? (await createSupplierSubscription(
          {
            supplierTenantId: auth.tenant.id,
            createdByMembershipId: auth.session.memberId,
            customerName,
            customerEmail,
            customerCcEmails,
            customerPhone: body.customerPhone || null,
            customerCompany: body.customerCompany || null,
            customerAddress: body.customerAddress || null,
            currency,
            taxCents,
            notes: body.notes || null,
            lines,
            interval: subscriptionInterval,
          },
          origin
        )).invoice
      : await createSupplierInvoice(
          {
            supplierTenantId: auth.tenant.id,
            createdByMembershipId: auth.session.memberId,
            customerName,
            customerEmail,
            customerCcEmails,
            customerPhone: body.customerPhone || null,
            customerCompany: body.customerCompany || null,
            customerAddress: body.customerAddress || null,
            currency,
            taxCents,
            notes: body.notes || null,
            lines,
          },
          origin
        );

    // Ops Telegram ping — new invoice created. Fire-and-forget, silent when
    // TELEGRAM_NOTIFY_* env not set. Runs before the email block so the
    // channel gets the "created" note even if SES is down.
    void notifyInvoiceCreated({
      invoiceNumber: invoice.invoiceNumber,
      amountCents: invoice.totalCents,
      currency: invoice.currency,
      subscription: isSubscription && subscriptionInterval
        ? { interval: subscriptionInterval, sequence: 1 }
        : null,
    });

    // Fire-and-forget the customer email. We DON'T block the API response on
    // SES — the invoice is already saved and the supplier has the pay link
    // in the response; a slow SES call would just make "create invoice" feel
    // sluggish. Record success (emailSentAt) or failure (emailFailedReason)
    // on the row so the UI can badge invoices whose email failed to go out.
    //
    // Supplier brand lookup happens here (needs profile + settings for the
    // display name + brand color); the service layer stays pure.
    void (async () => {
      try {
        if (!invoice.paymentLinkUrl) return; // Nothing to link to; skip.
        const supplier = await prisma.tenant.findUnique({
          where: { id: auth.tenant.id },
          select: {
            name: true,
            supplierProfile: {
              select: { displayName: true, contactEmail: true },
            },
            settings: { select: { brandName: true, brandPrimaryColor: true } },
          },
        });
        const displayName =
          supplier?.supplierProfile?.displayName ||
          supplier?.settings?.brandName ||
          supplier?.name ||
          "hub";
        // #6u: pull vendor branding off the created invoice's product lines
        // so the email uses vendor theme (MegoPay = Deep Navy + Electric Blue).
        // #G1: same query now also fetches the subscription link (sequence +
        // cancel token) so the email can carry the "Cancel subscription" link.
        const invoiceWithVendor = await prisma.supplierInvoice.findUnique({
          where: { id: invoice.id },
          select: {
            subscriptionSequence: true,
            subscription: {
              select: { cancelToken: true, interval: true },
            },
            items: {
              select: {
                product: {
                  select: {
                    vendorName: true,
                    vendorLogoUrl: true,
                    vendorBrandColor: true,
                    vendorLegalName: true,
                    vendorLicenseText: true,
                    vendorStatementDescriptor: true,
                    vendorSupportEmail: true,
                  },
                },
              },
            },
          },
        });
        await sendSupplierInvoiceEmail({
          to: customerEmail,
          cc: customerCcEmails,
          supplierDisplayName: displayName,
          supplierContactEmail: supplier?.supplierProfile?.contactEmail || null,
          invoiceNumber: invoice.invoiceNumber,
          totalCents: invoice.totalCents,
          currency: invoice.currency,
          itemCount: invoice.items.length,
          paymentLinkUrl: invoice.paymentLinkUrl,
          brandPrimaryColor: supplier?.settings?.brandPrimaryColor || null,
          notes: invoice.notes,
          vendor: invoiceWithVendor
            ? resolveInvoiceVendor(invoiceWithVendor.items)
            : null,
          subscription:
            invoiceWithVendor?.subscription && invoiceWithVendor.subscriptionSequence
              ? {
                  sequence: invoiceWithVendor.subscriptionSequence,
                  interval: invoiceWithVendor.subscription.interval,
                  cancelUrl: `${origin.replace(/\/+$/, "")}/subscriptions/${invoiceWithVendor.subscription.cancelToken}/cancel`,
                }
              : null,
        });
        await prisma.supplierInvoice.update({
          where: { id: invoice.id },
          data: { emailSentAt: new Date(), emailFailedReason: null },
        });
      } catch (err: any) {
        console.error("[SUPPLIER-INVOICES] email send failed:", err);
        await prisma.supplierInvoice
          .update({
            where: { id: invoice.id },
            data: {
              emailFailedReason:
                (err?.name || "Error") + ": " + String(err?.message || err).slice(0, 500),
            },
          })
          .catch(() => {});
      }
    })();

    return NextResponse.json({ success: true, invoice });
  } catch (err: any) {
    console.error("[SUPPLIER-INVOICES] create error:", err);
    const message = typeof err?.message === "string" ? err.message : "Failed to create invoice";
    // Business-rule errors from the service layer are safe to bubble up.
    const status = /at least one line|greater than zero|unique invoice/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
