// POST /api/supplier/payment-links/[id]/webhook-test
//
// Phase I #5 v2 (2026-09-14). Fires a synthetic payment.succeeded to
// this link's configured webhook using realistic-but-fake data, so
// the partner can verify their handler + signature check before real
// money moves. Refuses if the link has no webhook configured yet.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getPartnerSession } from "@/lib/partner-auth";
import { buildWebhookContext } from "@/lib/webhooks/context";
import { renderWebhookBody } from "@/lib/webhooks/render";
import { deliverWebhook } from "@/lib/webhooks/deliver";

interface Params {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await getPartnerSession(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const link = await prisma.supplierPaymentLink.findFirst({
    where: { id, supplierTenantId: session.tenantId },
    include: {
      supplier: {
        select: {
          id: true,
          slug: true,
          name: true,
          timezone: true,
          currency: true,
          settings: { select: { brandName: true } },
        },
      },
    },
  });
  if (!link) {
    return NextResponse.json({ error: "Payment link not found" }, { status: 404 });
  }
  // Phase I #5 v3 (2026-09-14): secret is now optional. URL + template
  // still required (nothing to POST otherwise).
  if (!link.webhookUrl || !link.webhookTemplate) {
    return NextResponse.json(
      { error: "This link has no webhook configured. Fill in the URL + template first, then save." },
      { status: 400 }
    );
  }

  const now = new Date();
  const context = buildWebhookContext({
    eventType: "payment.succeeded",
    webhookSecret: link.webhookSecret,
    tenant: {
      id: link.supplier.id,
      slug: link.supplier.slug,
      name: link.supplier.name,
      brandName: link.supplier.settings?.brandName ?? undefined,
      timezone: link.supplier.timezone ?? undefined,
      currency: link.supplier.currency,
    },
    payment: {
      id: "pay_test_" + Math.random().toString(36).slice(2, 10),
      amount: link.unitAmountCents ?? 12500,
      currency: link.currency.toLowerCase(),
      status: "succeeded",
      paidAt: now,
      method: "card",
      processor: { name: "stripe" },
      card: { brand: "visa", last4: "4242" },
    },
    customer: {
      email: "test.customer@example.com",
      name: "Test Customer",
    },
    source: {
      kind: "payment_link",
      paymentLink: {
        id: link.id,
        slug: link.shortSlug,
        name: link.nickname,
        amount: link.unitAmountCents ?? 12500,
      },
    },
    metadata: { test: true, note: "Fired from the Send Test Event button" },
  });

  const eventId = String((context.event as Record<string, unknown>).id);
  const rendered = renderWebhookBody(link.webhookTemplate, context);
  const result = await deliverWebhook({
    paymentLinkId: link.id,
    tenantId: link.supplierTenantId,
    url: link.webhookUrl,
    secret: link.webhookSecret,
    contentType: link.webhookContentType,
    eventType: "payment.succeeded",
    eventId,
    body: rendered,
  });

  return NextResponse.json({
    ok: result.succeeded,
    attempts: result.attempts,
    finalStatus: result.finalStatus,
    errorMessage: result.errorMessage,
    // Echo the rendered body so the modal can show what was sent —
    // essential for template debugging.
    renderedBody: rendered,
    eventId,
  });
}
