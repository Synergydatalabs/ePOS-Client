// Marketplace notification helpers.
//
// Every function in this file wraps one of the sendPo*Email templates with:
//   1. Owner-email lookup for the target tenant (TENANT_OWNER Membership)
//   2. Deep-link URL construction (uses NEXT_PUBLIC_BASE_URL)
//   3. Fire-and-forget + logging — email failures NEVER block PO transitions
//
// Endpoints call these directly and don't await the result. A missing owner
// email or a transient SES error just gets logged; the PO still commits.

import prisma from "@/lib/prisma";
import {
  sendPoSubmittedEmail,
  sendPoAcknowledgedEmail,
  sendPoShippedEmail,
  sendPoDeliveredEmail,
  sendPoCancelledEmail,
  sendPoPaidSupplierEmail,
  sendPoPaidMerchantEmail,
  sendPoNewMessageEmail,
} from "@/lib/email";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "";

// Find the TENANT_OWNER's login email for a tenant. If the owner has been
// deactivated or removed, we fall back to any ACTIVE membership so the
// business doesn't miss notifications entirely.
//
// Later enhancement: per-tenant notification preferences table (mute types,
// additional recipients, digest schedule). For Phase B v1 we only send to
// the owner and keep the flow simple.
async function findRecipientEmail(tenantId: string): Promise<string | null> {
  const owner = await prisma.membership.findFirst({
    where: { tenantId, role: "TENANT_OWNER", status: "ACTIVE" },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  if (owner) return owner.email;

  const anyActive = await prisma.membership.findFirst({
    where: { tenantId, status: "ACTIVE" },
    select: { email: true },
    orderBy: { createdAt: "asc" },
  });
  return anyActive?.email || null;
}

// Small helper: fire-and-forget wrapper. Every send goes through this so we
// have ONE place that logs failures — greppable + reliable in production.
function safeSend(context: string, fn: () => Promise<void>): void {
  fn().catch((err: any) => {
    console.error(`[PO-NOTIFY] ${context} email failed:`, err?.message || err);
  });
}

// ---------------------------------------------------------------------------
// PO submitted → notify supplier
// ---------------------------------------------------------------------------
export async function notifyPoSubmitted(po: {
  id: string;
  poNumber: string;
  supplierTenantId: string;
  merchantTenantName: string;
  itemCount: number;
  totalCents: number;
  currency: string;
}): Promise<void> {
  const to = await findRecipientEmail(po.supplierTenantId);
  if (!to) {
    console.warn(`[PO-NOTIFY] No recipient email for supplier ${po.supplierTenantId} on ${po.poNumber}`);
    return;
  }
  safeSend(`PO ${po.poNumber} submitted`, () =>
    sendPoSubmittedEmail({
      to,
      poNumber: po.poNumber,
      merchantName: po.merchantTenantName,
      itemCount: po.itemCount,
      totalCents: po.totalCents,
      currency: po.currency,
      supplierPoUrl: `${BASE_URL}/supplier/orders/${po.id}`,
    })
  );
}

// ---------------------------------------------------------------------------
// PO acknowledged → notify merchant
// ---------------------------------------------------------------------------
export async function notifyPoAcknowledged(po: {
  id: string;
  poNumber: string;
  merchantTenantId: string;
  supplierTenantName: string;
}): Promise<void> {
  const to = await findRecipientEmail(po.merchantTenantId);
  if (!to) {
    console.warn(`[PO-NOTIFY] No recipient email for merchant ${po.merchantTenantId} on ${po.poNumber}`);
    return;
  }
  safeSend(`PO ${po.poNumber} acknowledged`, () =>
    sendPoAcknowledgedEmail({
      to,
      poNumber: po.poNumber,
      supplierName: po.supplierTenantName,
      merchantPoUrl: `${BASE_URL}/dashboard/admin/marketplace/orders/${po.id}`,
    })
  );
}

// ---------------------------------------------------------------------------
// PO shipped → notify merchant
// ---------------------------------------------------------------------------
export async function notifyPoShipped(po: {
  id: string;
  poNumber: string;
  merchantTenantId: string;
  supplierTenantName: string;
  shipmentCarrier: string | null;
  shipmentTrackingRef: string | null;
  expectedDeliveryAt: Date | null;
}): Promise<void> {
  const to = await findRecipientEmail(po.merchantTenantId);
  if (!to) {
    console.warn(`[PO-NOTIFY] No recipient email for merchant ${po.merchantTenantId} on ${po.poNumber}`);
    return;
  }
  safeSend(`PO ${po.poNumber} shipped`, () =>
    sendPoShippedEmail({
      to,
      poNumber: po.poNumber,
      supplierName: po.supplierTenantName,
      carrier: po.shipmentCarrier,
      trackingRef: po.shipmentTrackingRef,
      expectedDeliveryAt: po.expectedDeliveryAt,
      merchantPoUrl: `${BASE_URL}/dashboard/admin/marketplace/orders/${po.id}`,
    })
  );
}

// ---------------------------------------------------------------------------
// PO delivered → notify supplier (thanks note)
// ---------------------------------------------------------------------------
export async function notifyPoDelivered(po: {
  id: string;
  poNumber: string;
  supplierTenantId: string;
  merchantTenantName: string;
}): Promise<void> {
  const to = await findRecipientEmail(po.supplierTenantId);
  if (!to) {
    console.warn(`[PO-NOTIFY] No recipient email for supplier ${po.supplierTenantId} on ${po.poNumber}`);
    return;
  }
  safeSend(`PO ${po.poNumber} delivered`, () =>
    sendPoDeliveredEmail({
      to,
      poNumber: po.poNumber,
      merchantName: po.merchantTenantName,
      supplierPoUrl: `${BASE_URL}/supplier/orders/${po.id}`,
    })
  );
}

// ---------------------------------------------------------------------------
// PO paid → notify BOTH sides (supplier gets "you got paid", merchant gets
// a payment receipt). Called from markPoAsPaid() after the DB transition.
// ---------------------------------------------------------------------------
export async function notifyPoPaid(po: {
  id: string;
  poNumber: string;
  supplierTenantId: string;
  merchantTenantId: string;
  paidAmountCents: number;
  currency: string;
  paidMethod: string;
}): Promise<void> {
  // Look up display names in parallel with the recipient emails to
  // minimize latency — one round of queries then two sends.
  const [supplierEmail, merchantEmail, supplierTenant, merchantTenant] = await Promise.all([
    findRecipientEmail(po.supplierTenantId),
    findRecipientEmail(po.merchantTenantId),
    prisma.tenant.findUnique({
      where: { id: po.supplierTenantId },
      select: { name: true, supplierProfile: { select: { displayName: true } } },
    }),
    prisma.tenant.findUnique({
      where: { id: po.merchantTenantId },
      select: { name: true },
    }),
  ]);

  const supplierName =
    supplierTenant?.supplierProfile?.displayName ||
    supplierTenant?.name ||
    "your supplier";
  const merchantName = merchantTenant?.name || "your merchant";

  if (supplierEmail) {
    safeSend(`PO ${po.poNumber} paid → supplier`, () =>
      sendPoPaidSupplierEmail({
        to: supplierEmail,
        poNumber: po.poNumber,
        merchantName,
        amountCents: po.paidAmountCents,
        currency: po.currency,
        paidMethod: po.paidMethod,
        supplierPoUrl: `${BASE_URL}/supplier/orders/${po.id}`,
      })
    );
  } else {
    console.warn(`[PO-NOTIFY] No recipient email for supplier ${po.supplierTenantId} on ${po.poNumber} paid`);
  }

  if (merchantEmail) {
    safeSend(`PO ${po.poNumber} paid → merchant`, () =>
      sendPoPaidMerchantEmail({
        to: merchantEmail,
        poNumber: po.poNumber,
        supplierName,
        amountCents: po.paidAmountCents,
        currency: po.currency,
        paidMethod: po.paidMethod,
        merchantPoUrl: `${BASE_URL}/dashboard/admin/marketplace/orders/${po.id}`,
      })
    );
  } else {
    console.warn(`[PO-NOTIFY] No recipient email for merchant ${po.merchantTenantId} on ${po.poNumber} paid`);
  }
}

// ---------------------------------------------------------------------------
// New PO message → notify the OTHER side
// ---------------------------------------------------------------------------
export async function notifyPoNewMessage(msg: {
  id: string; // purchaseOrderId
  poNumber: string;
  senderSide: "MERCHANT" | "SUPPLIER";
  senderName: string;
  bodyPreview: string;
  merchantTenantId: string;
  supplierTenantId: string;
}): Promise<void> {
  const recipientTenantId =
    msg.senderSide === "MERCHANT" ? msg.supplierTenantId : msg.merchantTenantId;
  const to = await findRecipientEmail(recipientTenantId);
  if (!to) {
    console.warn(
      `[PO-NOTIFY] No recipient email for ${recipientTenantId} on ${msg.poNumber} new-message`
    );
    return;
  }
  const recipientPoUrl =
    msg.senderSide === "MERCHANT"
      ? `${BASE_URL}/supplier/orders/${msg.id}`
      : `${BASE_URL}/dashboard/admin/marketplace/orders/${msg.id}`;
  safeSend(`PO ${msg.poNumber} new message`, () =>
    sendPoNewMessageEmail({
      to,
      poNumber: msg.poNumber,
      senderName: msg.senderName,
      senderSide: msg.senderSide,
      bodyPreview: msg.bodyPreview,
      recipientPoUrl,
    })
  );
}

// ---------------------------------------------------------------------------
// PO cancelled → notify the OTHER side
// ---------------------------------------------------------------------------
export async function notifyPoCancelled(po: {
  id: string;
  poNumber: string;
  cancelledBy: "merchant" | "supplier";
  merchantTenantId: string;
  merchantTenantName: string;
  supplierTenantId: string;
  supplierTenantName: string;
  cancellationReason: string;
}): Promise<void> {
  // Notify whoever did NOT cancel — the other party needs to know.
  const recipientTenantId =
    po.cancelledBy === "merchant" ? po.supplierTenantId : po.merchantTenantId;
  const otherPartyName =
    po.cancelledBy === "merchant" ? po.merchantTenantName : po.supplierTenantName;

  const to = await findRecipientEmail(recipientTenantId);
  if (!to) {
    console.warn(`[PO-NOTIFY] No recipient email for ${recipientTenantId} on ${po.poNumber} cancel`);
    return;
  }

  const recipientPoUrl =
    po.cancelledBy === "merchant"
      ? `${BASE_URL}/supplier/orders/${po.id}` // supplier is the recipient
      : `${BASE_URL}/dashboard/admin/marketplace/orders/${po.id}`; // merchant is the recipient

  safeSend(`PO ${po.poNumber} cancelled`, () =>
    sendPoCancelledEmail({
      to,
      poNumber: po.poNumber,
      otherPartyName,
      cancelledBy: po.cancelledBy,
      cancellationReason: po.cancellationReason,
      recipientPoUrl,
    })
  );
}
