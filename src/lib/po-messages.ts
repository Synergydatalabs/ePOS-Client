// Purchase-order messaging — shared logic between merchant + supplier
// endpoints. Auth checks stay in the endpoints (they use different auth
// systems); this file owns the DB reads/writes so behavior can't drift
// between the two sides.

import type { PoMessageSide, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { notifyPoNewMessage } from "@/lib/marketplace-notify";

const MAX_BODY_LENGTH = 4000;

export async function listPoMessages(purchaseOrderId: string) {
  return prisma.purchaseOrderMessage.findMany({
    where: { purchaseOrderId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      senderSide: true,
      senderName: true,
      body: true,
      readByOtherSideAt: true,
      createdAt: true,
    },
  });
}

export interface PostPoMessageParams {
  purchaseOrderId: string;
  poNumber: string;
  senderSide: PoMessageSide;
  senderMembershipId: string | null;
  senderName: string | null;
  body: string;
  // The tenants on each side — used to route the notification email.
  merchantTenantId: string;
  supplierTenantId: string;
}

export interface PostPoMessageResult {
  ok: true;
  message: {
    id: string;
    senderSide: PoMessageSide;
    senderName: string | null;
    body: string;
    readByOtherSideAt: Date | null;
    createdAt: Date;
  };
}

export interface PostPoMessageError {
  ok: false;
  status: number;
  error: string;
}

export async function postPoMessage(
  params: PostPoMessageParams
): Promise<PostPoMessageResult | PostPoMessageError> {
  const trimmed = params.body?.trim() ?? "";
  if (!trimmed) {
    return { ok: false, status: 400, error: "Message body is required" };
  }
  if (trimmed.length > MAX_BODY_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Message is too long (max ${MAX_BODY_LENGTH} characters)`,
    };
  }

  const message = await prisma.purchaseOrderMessage.create({
    data: {
      purchaseOrderId: params.purchaseOrderId,
      senderSide: params.senderSide,
      senderMembershipId: params.senderMembershipId,
      senderName: params.senderName,
      body: trimmed,
    },
    select: {
      id: true,
      senderSide: true,
      senderName: true,
      body: true,
      readByOtherSideAt: true,
      createdAt: true,
    },
  });

  // Notify the OTHER side. Fire-and-forget — send failure never blocks
  // the message write, notification errors get logged inside the helper.
  notifyPoNewMessage({
    id: params.purchaseOrderId,
    poNumber: params.poNumber,
    senderSide: params.senderSide,
    senderName: params.senderName || "Someone",
    bodyPreview: trimmed,
    merchantTenantId: params.merchantTenantId,
    supplierTenantId: params.supplierTenantId,
  });

  return { ok: true, message };
}

/**
 * Marks every message from the OPPOSITE side as read by the viewer's side.
 * Idempotent: already-read messages stay stamped with their original time.
 */
export async function markPoMessagesRead(params: {
  purchaseOrderId: string;
  viewerSide: PoMessageSide;
  tx?: Prisma.TransactionClient;
}): Promise<{ markedCount: number }> {
  const otherSide: PoMessageSide =
    params.viewerSide === "MERCHANT" ? "SUPPLIER" : "MERCHANT";
  const client = params.tx ?? prisma;
  const result = await client.purchaseOrderMessage.updateMany({
    where: {
      purchaseOrderId: params.purchaseOrderId,
      senderSide: otherSide,
      readByOtherSideAt: null,
    },
    data: { readByOtherSideAt: new Date() },
  });
  return { markedCount: result.count };
}

/**
 * Counts unread messages from the OPPOSITE side for a batch of POs.
 * Used by both order-list endpoints for the badge — one grouped query
 * instead of N per row.
 *
 * Returns a Map<purchaseOrderId, unreadCount>. POs with no unread
 * messages don't appear in the map (caller defaults to 0).
 */
export async function unreadMessageCounts(
  purchaseOrderIds: string[],
  viewerSide: PoMessageSide
): Promise<Map<string, number>> {
  if (purchaseOrderIds.length === 0) return new Map();
  const otherSide: PoMessageSide = viewerSide === "MERCHANT" ? "SUPPLIER" : "MERCHANT";
  const rows = await prisma.purchaseOrderMessage.groupBy({
    by: ["purchaseOrderId"],
    where: {
      purchaseOrderId: { in: purchaseOrderIds },
      senderSide: otherSide,
      readByOtherSideAt: null,
    },
    _count: true,
  });
  return new Map(rows.map((r) => [r.purchaseOrderId, r._count]));
}
