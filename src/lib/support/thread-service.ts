// Tenant-scoped support-chat service — the merchant/supplier counterpart
// to tapapp-admin's thread-service.ts. The critical guarantee: every query
// filters by the caller's tenantId, so a merchant can never see a thread
// belonging to a different merchant. Internal notes (internalNote=true on
// SupportMessage) are stripped at query time — those are admin-only.

import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type {
  SupportPartyTypeValue,
  SupportThreadStatusValue,
} from "./constants";
import type { SupportTenantRole } from "./session";

// Thread list — narrow fields, no message body, capped at 50. Sorted by
// last activity so the most recent conversation is at the top.
export const THREAD_LIST_SELECT = {
  id: true,
  subject: true,
  status: true,
  entityType: true,
  entityId: true,
  merchantTenantId: true,
  supplierTenantId: true,
  createdByType: true,
  createdByName: true,
  lastMessageAt: true,
  createdAt: true,
  _count: { select: { messages: { where: { internalNote: false } } } },
} satisfies Prisma.SupportThreadSelect;

// Whichever tenant column matches this caller — used everywhere.
function tenantScope(
  tenantId: string,
  tenantRole: SupportTenantRole
): Prisma.SupportThreadWhereInput {
  return tenantRole === "MERCHANT"
    ? { merchantTenantId: tenantId }
    : { supplierTenantId: tenantId };
}

export async function listThreadsForTenant(args: {
  tenantId: string;
  tenantRole: SupportTenantRole;
  status?: SupportThreadStatusValue | "ALL";
  take?: number;
}) {
  const where: Prisma.SupportThreadWhereInput = {
    ...tenantScope(args.tenantId, args.tenantRole),
    ...(args.status && args.status !== "ALL" ? { status: args.status } : {}),
  };
  return prisma.supportThread.findMany({
    where,
    select: THREAD_LIST_SELECT,
    orderBy: { lastMessageAt: "desc" },
    take: args.take ?? 50,
  });
}

// Detail view: thread + non-internal messages. If the caller's tenantId
// doesn't match the thread, we return null so the route replies 404
// (never 403 — don't leak thread existence to non-parties).
export async function getThreadForTenant(args: {
  threadId: string;
  tenantId: string;
  tenantRole: SupportTenantRole;
}) {
  const thread = await prisma.supportThread.findFirst({
    where: {
      id: args.threadId,
      ...tenantScope(args.tenantId, args.tenantRole),
    },
    include: {
      messages: {
        where: { internalNote: false },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return thread;
}

export interface CreateTenantThreadInput {
  subject: string;
  firstMessage: string;
  tenantId: string;
  tenantRole: SupportTenantRole;
  senderUserId: string;
  senderDisplayName: string;
}

// Tenant-initiated thread → to admin. merchantTenantId or supplierTenantId
// is set from the caller's own tenant; the other party is admin (implicit —
// any SUPPORT/SUPER_ADMIN can pick it up). createdByType is MERCHANT or
// SUPPLIER to match who opened it.
export async function createThreadFromTenant(input: CreateTenantThreadInput) {
  const createdByType: SupportPartyTypeValue =
    input.tenantRole === "MERCHANT" ? "MERCHANT" : "SUPPLIER";
  return prisma.$transaction(async (tx) => {
    const thread = await tx.supportThread.create({
      data: {
        subject: input.subject.trim(),
        status: "WAITING_ADMIN",
        merchantTenantId: input.tenantRole === "MERCHANT" ? input.tenantId : null,
        supplierTenantId: input.tenantRole === "SUPPLIER" ? input.tenantId : null,
        createdByType,
        createdByUserId: input.senderUserId,
        createdByName: input.senderDisplayName,
      },
    });
    await tx.supportMessage.create({
      data: {
        threadId: thread.id,
        senderType: createdByType,
        senderId: input.senderUserId,
        senderName: input.senderDisplayName,
        body: input.firstMessage.trim(),
        internalNote: false,
      },
    });
    return thread;
  });
}

export interface AttachmentInput {
  s3Key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface PostTenantMessageInput {
  threadId: string;
  tenantId: string;
  tenantRole: SupportTenantRole;
  senderUserId: string;
  senderDisplayName: string;
  body: string;
  attachments?: AttachmentInput[];
}

// Merchant/supplier reply. Verifies the thread belongs to this tenant
// first — throwing NotFound if not — so a stolen thread id from another
// tenant can't be replied on. Status flips to WAITING_ADMIN.
export async function postTenantMessage(input: PostTenantMessageInput) {
  const thread = await prisma.supportThread.findFirst({
    where: {
      id: input.threadId,
      ...tenantScope(input.tenantId, input.tenantRole),
    },
    select: { id: true, status: true },
  });
  if (!thread) throw new Error("thread_not_found");

  const senderType: SupportPartyTypeValue =
    input.tenantRole === "MERCHANT" ? "MERCHANT" : "SUPPLIER";

  return prisma.$transaction(async (tx) => {
    const message = await tx.supportMessage.create({
      data: {
        threadId: thread.id,
        senderType,
        senderId: input.senderUserId,
        senderName: input.senderDisplayName,
        body: input.body.trim(),
        internalNote: false,
      },
    });
    if (input.attachments && input.attachments.length > 0) {
      await tx.supportMessageAttachment.createMany({
        data: input.attachments.map((a) => ({
          messageId: message.id,
          s3Key: a.s3Key,
          fileName: a.fileName,
          contentType: a.contentType,
          sizeBytes: BigInt(a.sizeBytes),
        })),
      });
    }
    await tx.supportThread.update({
      where: { id: thread.id },
      data: {
        lastMessageAt: message.createdAt,
        status:
          thread.status === "CLOSED" || thread.status === "RESOLVED"
            ? undefined
            : "WAITING_ADMIN",
      },
    });
    return message;
  });
}

// Detail with attachments included. Kept separate from getThreadForTenant
// so that older call sites don't accidentally start paying for the join.
export async function getThreadForTenantWithAttachments(args: {
  threadId: string;
  tenantId: string;
  tenantRole: SupportTenantRole;
}) {
  const scope =
    args.tenantRole === "MERCHANT"
      ? { merchantTenantId: args.tenantId }
      : { supplierTenantId: args.tenantId };
  return prisma.supportThread.findFirst({
    where: { id: args.threadId, ...scope },
    include: {
      messages: {
        where: { internalNote: false },
        orderBy: { createdAt: "asc" },
        include: { attachments: true },
      },
    },
  });
}

// Upsert a read receipt for this tenant on this thread. Composite PK
// (threadId, readerType, readerId) so a repeat call just moves the
// timestamp forward.
export async function markThreadRead(args: {
  threadId: string;
  tenantId: string;
  tenantRole: SupportTenantRole;
  readerUserId: string;
}) {
  const scope =
    args.tenantRole === "MERCHANT"
      ? { merchantTenantId: args.tenantId }
      : { supplierTenantId: args.tenantId };
  const thread = await prisma.supportThread.findFirst({
    where: { id: args.threadId, ...scope },
    select: { id: true },
  });
  if (!thread) throw new Error("thread_not_found");

  const readerType = args.tenantRole === "MERCHANT" ? "MERCHANT" : "SUPPLIER";
  const now = new Date();
  await prisma.supportReadReceipt.upsert({
    where: {
      threadId_readerType_readerId: {
        threadId: thread.id,
        readerType,
        readerId: args.readerUserId,
      },
    },
    create: {
      threadId: thread.id,
      readerType,
      readerId: args.readerUserId,
      lastReadAt: now,
    },
    update: { lastReadAt: now },
  });
}

// Unread count = threads where the latest non-internal message is newer
// than the caller's read receipt (or no receipt exists). Also returns
// the list of threadIds so the client can highlight them.
export async function getUnreadForTenant(args: {
  tenantId: string;
  tenantRole: SupportTenantRole;
  readerUserId: string;
}) {
  const scope =
    args.tenantRole === "MERCHANT"
      ? { merchantTenantId: args.tenantId }
      : { supplierTenantId: args.tenantId };
  const readerType = args.tenantRole === "MERCHANT" ? "MERCHANT" : "SUPPLIER";

  const threads = await prisma.supportThread.findMany({
    where: {
      ...scope,
      // Skip threads with no visible messages — a hypothetical empty
      // thread would otherwise register as "unread forever."
      messages: { some: { internalNote: false } },
    },
    select: {
      id: true,
      lastMessageAt: true,
    },
  });

  if (threads.length === 0) return { count: 0, threadIds: [] as string[] };

  const receipts = await prisma.supportReadReceipt.findMany({
    where: {
      threadId: { in: threads.map((t) => t.id) },
      readerType,
      readerId: args.readerUserId,
    },
    select: { threadId: true, lastReadAt: true },
  });
  const readMap = new Map(receipts.map((r) => [r.threadId, r.lastReadAt]));

  const unreadIds: string[] = [];
  for (const t of threads) {
    const readAt = readMap.get(t.id);
    if (!readAt || readAt < t.lastMessageAt) unreadIds.push(t.id);
  }
  return { count: unreadIds.length, threadIds: unreadIds };
}
