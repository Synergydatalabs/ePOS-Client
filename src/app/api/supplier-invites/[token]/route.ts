// GET /api/supplier-invites/[token] — public endpoint, validates an invite
// token and returns the info needed to render the accept page (who invited
// them + what they're being asked to join). Never exposes the invite ID.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    if (!token || token.length < 32) {
      return NextResponse.json({ error: "Invalid invitation link" }, { status: 400 });
    }

    const invite = await prisma.supplierInvite.findUnique({
      where: { token },
      include: {
        fromTenant: { select: { name: true, slug: true } },
      },
    });

    if (!invite) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }

    if (invite.status === "CANCELLED") {
      return NextResponse.json(
        { error: "This invitation has been cancelled by the merchant." },
        { status: 410 }
      );
    }
    if (invite.status === "ACCEPTED") {
      return NextResponse.json(
        { error: "This invitation has already been accepted." },
        { status: 410 }
      );
    }
    if (invite.status === "EXPIRED" || invite.expiresAt < new Date()) {
      // Lazily flip expired invites on read — cheap upkeep, keeps status
      // accurate without needing a cron job.
      if (invite.status !== "EXPIRED") {
        await prisma.supplierInvite.update({
          where: { id: invite.id },
          data: { status: "EXPIRED" },
        });
      }
      return NextResponse.json(
        { error: "This invitation has expired." },
        { status: 410 }
      );
    }

    return NextResponse.json({
      success: true,
      invite: {
        email: invite.email,
        companyName: invite.companyName,
        contactName: invite.contactName,
        phone: invite.phone,
        message: invite.message,
        expiresAt: invite.expiresAt,
        fromBusinessName: invite.fromTenant.name,
      },
    });
  } catch (error: any) {
    // Log everything Prisma exposes — code/meta reveal schema-drift vs
    // FK vs unique errors at a glance in pm2 logs. Common cause for
    // this endpoint returning 500: the generated Prisma client is
    // missing `supplierInvite` — run `npx prisma generate` on the
    // server after any schema change.
    console.error("[SUPPLIER-INVITES] Validate error:", {
      name: error?.name,
      message: error?.message,
      prismaCode: error?.code,
      prismaMeta: error?.meta,
      stack: error?.stack,
    });
    return NextResponse.json(
      {
        error: "Failed to load invitation",
        // Surface a hint the client can display so ops sees the specific
        // reason without having to SSH. Safe to expose — the token is
        // already the auth here; leaking a Prisma error name doesn't
        // widen the attack surface.
        detail: error?.message || null,
        code: error?.code || null,
      },
      { status: 500 }
    );
  }
}
