// GET /api/tenants/[tenantId]/guest-profiles/[guestId]
//   Full detail including recent orders (matched by phone OR email since
//   Order doesn't hold a guestProfileId FK) and loyalty balance if the
//   tenant has a program.

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

type Params = { params: Promise<{ tenantId: string; guestId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { tenantId, guestId } = await params;
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const guest = await prisma.guestProfile.findFirst({
      where: { id: guestId, tenantId },
    });
    if (!guest) {
      return NextResponse.json({ error: "Guest not found" }, { status: 404 });
    }

    // Recent orders — match by phone OR email since we don't store a
    // guestProfileId on Order. Limit to 5 for the POS side-panel.
    const orMatchers: any[] = [];
    if (guest.phone) orMatchers.push({ customerPhone: guest.phone });
    if (guest.email)
      orMatchers.push({
        customerEmail: { equals: guest.email, mode: "insensitive" },
      });

    const recentOrders =
      orMatchers.length > 0
        ? await prisma.order.findMany({
            where: {
              location: { tenantId },
              OR: orMatchers,
              status: { notIn: ["CANCELLED"] },
            },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: {
              id: true,
              displayNumber: true,
              orderNumber: true,
              total: true,
              currency: true,
              status: true,
              paymentStatus: true,
              createdAt: true,
            },
          })
        : [];

    // Loyalty balance across programs at this tenant, keyed by phone/email
    const loyalty =
      orMatchers.length > 0
        ? await prisma.customerLoyalty.findFirst({
            where: {
              program: { tenantId },
              OR: [
                ...(guest.phone ? [{ phone: guest.phone }] : []),
                ...(guest.email
                  ? [{ email: { equals: guest.email, mode: "insensitive" as const } }]
                  : []),
              ],
            },
            select: {
              id: true,
              totalPoints: true,
              lifetimePoints: true,
              visitCount: true,
              totalSpent: true,
              currentStreak: true,
              lastVisit: true,
              program: { select: { id: true, name: true } },
            },
          })
        : null;

    return NextResponse.json({
      success: true,
      guest,
      recentOrders,
      loyalty,
    });
  } catch (error: any) {
    console.error("[guest-profiles detail] error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load" },
      { status: 500 }
    );
  }
}
