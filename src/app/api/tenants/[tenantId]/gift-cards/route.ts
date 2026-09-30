// POST /api/tenants/[tenantId]/gift-cards
//   Issue one gift card (DIGITAL) or a batch of physical cards (PHYSICAL).
//   Body: { type, amount, currency?, quantity?, recipient?, message?, senderName?, expiresAt? }
//   For DIGITAL: quantity is always 1, recipientEmail is required.
//   For PHYSICAL: quantity 1..500, no recipient fields required.
//
// GET /api/tenants/[tenantId]/gift-cards
//   List cards with pagination + filters.
//   Query: ?status=ACTIVE&type=DIGITAL&search=code_or_email&page=1&pageSize=25

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { generateGiftCardCode } from "@/lib/gift-card-code";
import crypto from "crypto";

type Params = { params: Promise<{ tenantId: string }> };

const MAX_BATCH = 500;

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const {
      type = "DIGITAL",
      amount, // cents
      currency,
      quantity = 1,
      recipientName,
      recipientEmail,
      recipientPhone,
      senderName,
      message,
      expiresAt,
    } = body as {
      type?: "DIGITAL" | "PHYSICAL";
      amount?: number;
      currency?: string;
      quantity?: number;
      recipientName?: string;
      recipientEmail?: string;
      recipientPhone?: string;
      senderName?: string;
      message?: string;
      expiresAt?: string;
    };

    if (!amount || amount < 100) {
      return NextResponse.json(
        { error: "Amount must be at least $1.00 (100 cents)" },
        { status: 400 }
      );
    }
    if (type === "DIGITAL" && !recipientEmail) {
      return NextResponse.json(
        { error: "Recipient email is required for digital gift cards" },
        { status: 400 }
      );
    }
    const qty = type === "PHYSICAL" ? Math.max(1, Math.min(MAX_BATCH, quantity)) : 1;

    // Look up tenant currency default so admins don't need to send it
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { currency: true },
    });
    const cur = (currency || tenant?.currency || "CAD").toUpperCase().slice(0, 3);

    // Batch id groups the physical cards together so they can be reprinted
    // as a unit. For a single digital card we still stamp one (nice for
    // consistency and future "resend to recipient").
    const batchId = crypto.randomUUID();
    const issuedById = auth.context.membership.id;
    const expiresAtDate = expiresAt ? new Date(expiresAt) : null;

    // Generate all codes up front so a collision on the very last card
    // doesn't require us to roll back several successful creates.
    // Very low chance given ~60 bits of entropy per code but we still
    // retry a few times on unique-constraint failure just in case.
    const created = await prisma.$transaction(async (tx) => {
      const cards = [];
      for (let i = 0; i < qty; i++) {
        let attempt = 0;
        let card = null;
        while (attempt < 5 && !card) {
          const code = generateGiftCardCode();
          try {
            card = await tx.giftCard.create({
              data: {
                tenantId,
                code,
                type,
                initialAmount: amount,
                balance: amount,
                currency: cur,
                recipientName: type === "DIGITAL" ? recipientName : null,
                recipientEmail: type === "DIGITAL" ? recipientEmail : null,
                recipientPhone: type === "DIGITAL" ? recipientPhone : null,
                senderName,
                message,
                batchId,
                issuedById,
                expiresAt: expiresAtDate,
                transactions: {
                  create: {
                    type: "ISSUE",
                    amount, // positive credit
                    balanceAfter: amount,
                    performedById: issuedById,
                    notes:
                      type === "DIGITAL"
                        ? `Digital card issued to ${recipientEmail || "recipient"}`
                        : `Physical card issued (batch ${batchId.slice(0, 8)})`,
                  },
                },
              },
            });
          } catch (err: any) {
            // P2002 = unique constraint (very rare code collision) — retry
            if (err?.code === "P2002") {
              attempt++;
              continue;
            }
            throw err;
          }
        }
        if (!card) {
          throw new Error("Could not generate unique gift card code after 5 attempts");
        }
        cards.push(card);
      }
      return cards;
    });

    return NextResponse.json({
      success: true,
      batchId,
      count: created.length,
      cards: created.map((c) => ({
        id: c.id,
        code: c.code,
        balance: c.balance,
        currency: c.currency,
        type: c.type,
        recipientEmail: c.recipientEmail,
      })),
    });
  } catch (error: any) {
    console.error("[gift-cards POST] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to issue gift card", code: error?.code },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId } = await params;

    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as
      | "ACTIVE"
      | "REDEEMED"
      | "EXPIRED"
      | "CANCELLED"
      | null;
    const type = searchParams.get("type") as "DIGITAL" | "PHYSICAL" | null;
    const search = searchParams.get("search")?.trim();
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("pageSize") || "25", 10))
    );

    const where: any = { tenantId };
    if (status) where.status = status;
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { recipientEmail: { contains: search, mode: "insensitive" } },
        { recipientName: { contains: search, mode: "insensitive" } },
      ];
    }

    const [total, cards, summary] = await Promise.all([
      prisma.giftCard.count({ where }),
      prisma.giftCard.findMany({
        where,
        orderBy: { issuedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          code: true,
          type: true,
          status: true,
          initialAmount: true,
          balance: true,
          currency: true,
          recipientName: true,
          recipientEmail: true,
          issuedAt: true,
          expiresAt: true,
          issuedBy: { select: { firstName: true, lastName: true, email: true } },
        },
      }),
      // Summary card totals (active balance + this-month issued) for the
      // dashboard header. Cheap enough to compute every request.
      prisma.giftCard.aggregate({
        where: { tenantId, status: "ACTIVE" },
        _sum: { balance: true },
        _count: { _all: true },
      }),
    ]);

    return NextResponse.json({
      success: true,
      cards,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
      summary: {
        outstandingBalance: summary._sum.balance || 0,
        activeCount: summary._count._all,
      },
    });
  } catch (error: any) {
    console.error("[gift-cards GET] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load gift cards" },
      { status: 500 }
    );
  }
}
