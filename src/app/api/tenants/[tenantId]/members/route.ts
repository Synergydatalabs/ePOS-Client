// POST /api/tenants/[tenantId]/members - Add staff member with password
// GET /api/tenants/[tenantId]/members - List members

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";
import { MemberRole } from "@/types";
import { hashPassword, validatePassword, generateTempPassword } from "@/lib/password";

// POST - Add new staff member with local password
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    // Validate request - require at least POS_ADMIN to add members
    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const body = await request.json();
    const { email, firstName, lastName, role, password, generatePassword, specialties, commissionRate } = body;

    if (!email) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 });
    }

    // Validate role - only staff roles can be added (not TENANT_OWNER)
    const validRoles: MemberRole[] = ["POS_ADMIN", "POS_MANAGER", "POS_STAFF", "KITCHEN_STAFF"];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: "Invalid role. Must be POS_ADMIN, POS_MANAGER, POS_STAFF, or KITCHEN_STAFF" },
        { status: 400 }
      );
    }

    // Check if already a member
    const existingMember = await prisma.membership.findFirst({
      where: {
        tenantId,
        email: email.toLowerCase(),
      },
    });

    if (existingMember) {
      if (existingMember.status === "ACTIVE") {
        return NextResponse.json(
          { error: "User is already a member of this business" },
          { status: 400 }
        );
      }

      // Reactivate suspended member with new password if provided
      if (existingMember.status === "SUSPENDED") {
        const updateData: any = {
          status: "ACTIVE",
          role,
          firstName: firstName || existingMember.firstName,
          lastName: lastName || existingMember.lastName,
          activatedAt: new Date(),
          loginAttempts: 0,
          lockedUntil: null,
        };

        // Set new password if provided
        if (password || generatePassword) {
          const finalPassword = password || generateTempPassword();

          if (password) {
            const passwordError = validatePassword(password);
            if (passwordError) {
              return NextResponse.json({ error: passwordError }, { status: 400 });
            }
          }

          updateData.passwordHash = await hashPassword(finalPassword);
          updateData.mustChangePassword = !password; // Must change if auto-generated
        }

        const updated = await prisma.membership.update({
          where: { id: existingMember.id },
          data: updateData,
        });

        return NextResponse.json({
          success: true,
          message: "Member reactivated",
          member: {
            id: updated.id,
            email: updated.email,
            role: updated.role,
            status: updated.status,
          },
          ...(generatePassword && !password ? { tempPassword: generateTempPassword() } : {}),
        });
      }
    }

    // Determine password
    let passwordHash: string | null = null;
    let tempPassword: string | undefined;
    let mustChangePassword = true;

    if (password) {
      // Validate custom password
      const passwordError = validatePassword(password);
      if (passwordError) {
        return NextResponse.json({ error: passwordError }, { status: 400 });
      }
      passwordHash = await hashPassword(password);
      mustChangePassword = false; // User provided their own password
    } else if (generatePassword !== false) {
      // Generate temporary password by default
      tempPassword = generateTempPassword();
      passwordHash = await hashPassword(tempPassword);
      mustChangePassword = true;
    }

    // Create new membership with local auth
    const membership = await prisma.membership.create({
      data: {
        tenantId,
        userSub: `local-${email.toLowerCase()}`, // 'local-' prefix for local auth users
        email: email.toLowerCase(),
        firstName: firstName || null,
        lastName: lastName || null,
        role,
        status: "ACTIVE", // Active immediately for local auth
        passwordHash,
        mustChangePassword,
        invitedBy: validation.context.membership.id,
        invitedAt: new Date(),
        activatedAt: new Date(),
        // Salon technician fields
        specialties: specialties || [],
        commissionRate: commissionRate != null ? commissionRate : null,
      },
    });

    console.log(`[TAP API] Added staff member: ${email} to tenant: ${tenantId} with local auth`);

    return NextResponse.json({
      success: true,
      message: tempPassword
        ? "Staff member created with temporary password"
        : "Staff member created",
      member: {
        id: membership.id,
        email: membership.email,
        firstName: membership.firstName,
        lastName: membership.lastName,
        role: membership.role,
        status: membership.status,
        mustChangePassword: membership.mustChangePassword,
      },
      // Only return temp password on creation - it won't be shown again!
      ...(tempPassword ? { tempPassword } : {}),
    });
  } catch (error: any) {
    console.error("[TAP API] Add member error:", error);
    return NextResponse.json(
      { error: "Failed to add member" },
      { status: 500 }
    );
  }
}

// GET - List members
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    // Validate request - any role can view members
    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    const members = await prisma.membership.findMany({
      where: {
        tenantId,
      },
      orderBy: [
        { status: "asc" }, // Active first
        { role: "asc" }, // Owner, Admin, Manager, Staff
        { createdAt: "asc" },
      ],
    });

    return NextResponse.json({
      success: true,
      members: members.map((m) => ({
        id: m.id,
        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        role: m.role,
        status: m.status,
        hasPassword: !!m.passwordHash,
        mustChangePassword: m.mustChangePassword,
        specialties: m.specialties || [],
        commissionRate: m.commissionRate ? Number(m.commissionRate) : null,
        invitedAt: m.invitedAt,
        activatedAt: m.activatedAt,
        lastActiveAt: m.lastActiveAt,
        createdAt: m.createdAt,
      })),
    });
  } catch (error: any) {
    console.error("[TAP API] List members error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
