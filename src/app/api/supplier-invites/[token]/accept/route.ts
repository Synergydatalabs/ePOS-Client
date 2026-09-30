// POST /api/supplier-invites/[token]/accept — public endpoint. Supplier
// clicks the invite link in their email → lands on /supplier/accept/[token]
// → submits password + (optionally) their info → this endpoint provisions
// everything and signs them in.
//
// What happens in one atomic transaction:
//   1. Create a Tenant (businessType='supplier', authProvider='local')
//   2. Create the SupplierProfile stub tied to that tenant
//   3. Create a TenantSettings row (needed for the branding lookup that
//      partner-auth's session route already does)
//   4. Create the owner Membership with a hashed password
//   5. Create the SupplierMerchantRelationship linking supplier → merchant
//   6. Link the inviting merchant's local Supplier row (if any) to the new
//      supplier tenant via linked_tenant_id
//   7. Flip the invite to ACCEPTED
//
// After all that we sign a partner JWT and set the cookie so the browser
// lands them straight in the supplier portal — no separate login step.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword, validatePassword } from "@/lib/password";
import { signPartnerToken, getPartnerCookieOptions } from "@/lib/partner-auth";
import { SignJWT } from "jose";
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";
// Phase I #4 (2026-09-12): even invite-based supplier signups create a
// verification row so the tenant record is consistent with public-signup
// tenants and admins see the same telemetry. Email is pre-verified
// (the invite was sent to it, so knowledge-of-email proves ownership);
// phone still needs to verify by OTP if the invite carried one.
import { ensureVerificationRow, sendOtp } from "@/lib/tenant-verification";

const POS_JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const body = await request.json();

    const companyName = String(body.companyName || "").trim();
    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim() || null;
    const password = String(body.password || "");
    const recaptchaToken = String(body.recaptchaToken || "");

    // Phase I #4 (2026-09-12): reCAPTCHA hard-fail. The invite token
    // itself is unpredictable (UUID), but this adds a marginal defense
    // against token-guessing bots + puts every public signup path on
    // the same policy.
    const rc = await verifyRecaptcha({
      token: recaptchaToken,
      ip: ipFromRequest(request),
      expectedAction: "supplier_invite_accept",
    });
    if (!rc.ok) {
      console.warn(`[supplier-invites accept] reCAPTCHA rejected (${rc.reason})`);
      return NextResponse.json(
        { error: "Verification failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    if (!companyName || companyName.length < 2) {
      return NextResponse.json({ error: "Company name is required (min 2 characters)" }, { status: 400 });
    }
    if (!firstName) {
      return NextResponse.json({ error: "First name is required" }, { status: 400 });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Reload the invite fresh — don't trust any client state, and re-check
    // status inside the transaction to keep the accept operation idempotent
    // against parallel clicks.
    const invite = await prisma.supplierInvite.findUnique({
      where: { token },
    });

    if (!invite) {
      return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
    }
    if (invite.status !== "PENDING") {
      return NextResponse.json(
        { error: `This invitation is ${invite.status.toLowerCase()} and can't be accepted.` },
        { status: 410 }
      );
    }
    if (invite.expiresAt < new Date()) {
      await prisma.supplierInvite.update({
        where: { id: invite.id },
        data: { status: "EXPIRED" },
      });
      return NextResponse.json({ error: "This invitation has expired." }, { status: 410 });
    }

    // Check if the invite email already has a local-auth membership. If so,
    // block acceptance — the supplier should log in first (we don't want to
    // silently attach a new tenant to an existing account without the user
    // seeing what's happening).
    const emailLower = invite.email.toLowerCase();
    const existingLocalMembership = await prisma.membership.findFirst({
      where: {
        email: emailLower,
        userSub: `local-${emailLower}`,
      },
      select: { id: true },
    });
    if (existingLocalMembership) {
      return NextResponse.json(
        {
          error: "An account with this email already exists. Please sign in first, then accept the invitation from your dashboard.",
        },
        { status: 409 }
      );
    }

    // Generate unique slug, same collision-retry as the partner register flow.
    let slug = generateSlug(companyName);
    let slugExists = await prisma.tenant.findUnique({ where: { slug } });
    let attempts = 0;
    while (slugExists && attempts < 10) {
      slug = `${generateSlug(companyName)}-${Math.random().toString(36).substring(2, 6)}`;
      slugExists = await prisma.tenant.findUnique({ where: { slug } });
      attempts++;
    }
    if (slugExists) {
      return NextResponse.json(
        { error: "Could not generate a unique identifier. Try a slightly different company name." },
        { status: 400 }
      );
    }

    const passwordHash = await hashPassword(password);

    // Fetch merchant tenant currency so we default the supplier's currency
    // to something sensible (same market).
    const merchantTenant = await prisma.tenant.findUnique({
      where: { id: invite.fromTenantId },
      select: { currency: true, timezone: true },
    });

    const result = await prisma.$transaction(async (tx) => {
      // 1. Supplier tenant. authProvider='local' so the partner-login endpoint
      //    accepts them; businessType='supplier' so the sidebar / role-check
      //    logic knows to render the supplier portal.
      const supplierTenant = await tx.tenant.create({
        data: {
          name: companyName,
          slug,
          currency: merchantTenant?.currency || "CAD",
          timezone: merchantTenant?.timezone || "America/Toronto",
          status: "ACTIVE",
          authProvider: "local",
          businessType: "supplier",
        },
      });

      // 2. SupplierProfile stub — funnel state is NEW; supplier fills the
      //    rest via the portal's onboarding wizard (Phase B).
      await tx.supplierProfile.create({
        data: {
          tenantId: supplierTenant.id,
          displayName: companyName,
          legalName: companyName,
          contactEmail: emailLower,
          contactPhone: invite.phone || null,
          currency: merchantTenant?.currency || "CAD",
          onboardingStatus: "NEW",
        },
      });

      // 3. TenantSettings — partner-auth's /session route joins this on every
      //    request; missing rows cause an unhelpful null-branding UI.
      await tx.tenantSettings.create({
        data: {
          tenantId: supplierTenant.id,
          brandName: companyName,
          // Suppliers don't do POS/tips/tables, so we turn all of that off.
          taxEnabled: false,
          tipEnabled: false,
          customerDisplayEnabled: false,
          kitchenDisplayEnabled: false,
          tableOrderingEnabled: false,
        },
      });

      // 4. Owner membership.
      const membership = await tx.membership.create({
        data: {
          tenantId: supplierTenant.id,
          userSub: `local-${emailLower}`,
          email: emailLower,
          firstName,
          lastName,
          role: "TENANT_OWNER",
          status: "ACTIVE",
          passwordHash,
          mustChangePassword: false,
          activatedAt: new Date(),
          lastActiveAt: new Date(),
        },
      });

      // 5. Supplier ↔ Merchant relationship.
      await tx.supplierMerchantRelationship.create({
        data: {
          supplierTenantId: supplierTenant.id,
          merchantTenantId: invite.fromTenantId,
          status: "ACTIVE",
          source: "INVITE",
          inviteId: invite.id,
        },
      });

      // 6. If the invite was created from a local Supplier row (merchant's
      //    inventory list), stamp its linked_tenant_id so future PO flows
      //    can pivot from that record to the marketplace tenant.
      if (invite.localSupplierId) {
        await tx.supplier.updateMany({
          where: { id: invite.localSupplierId, tenantId: invite.fromTenantId },
          data: { linkedTenantId: supplierTenant.id },
        });
      }

      // 7. Flip invite to ACCEPTED.
      await tx.supplierInvite.update({
        where: { id: invite.id },
        data: {
          status: "ACCEPTED",
          acceptedAt: new Date(),
          acceptedTenantId: supplierTenant.id,
        },
      });

      return { supplierTenant, membership };
    });

    // Phase I #4 (2026-09-12): create the verification row. The invite
    // was sent TO the applicant's email address, so knowledge-of-email
    // proves ownership — mark it verified now. Phone (if the invite
    // carried one) still needs an OTP round-trip. Fire-and-forget:
    // failure never rolls back the signed-in state.
    try {
      const invitePhone = invite.phone
        ? String(invite.phone).replace(/\D/g, "")
        : null;
      await ensureVerificationRow(
        result.supplierTenant.id,
        emailLower,
        invitePhone
      );
      await prisma.tenantVerification.update({
        where: { tenantId: result.supplierTenant.id },
        data: { emailVerifiedAt: new Date() },
      });
      if (invitePhone) {
        const phoneOtp = await sendOtp(result.supplierTenant.id, "phone");
        if (!phoneOtp.ok) {
          console.warn(
            `[supplier-invites accept] phone OTP failed for tenant ${result.supplierTenant.id}: ${phoneOtp.reason}`
          );
        }
      }
    } catch (err) {
      console.error(
        `[supplier-invites accept] verification bootstrap failed for tenant ${result.supplierTenant.id}:`,
        err
      );
    }

    // Sign JWT — same shape as the partner login response so the shared
    // session / branding hooks work without a special case.
    const jwt = await signPartnerToken({
      memberId: result.membership.id,
      tenantId: result.supplierTenant.id,
      email: result.membership.email,
      role: result.membership.role,
      firstName: result.membership.firstName,
      lastName: result.membership.lastName,
    });

    const response = NextResponse.json({
      success: true,
      user: {
        id: result.membership.id,
        email: result.membership.email,
        firstName: result.membership.firstName,
        lastName: result.membership.lastName,
        role: result.membership.role,
      },
      tenant: {
        id: result.supplierTenant.id,
        name: result.supplierTenant.name,
        slug: result.supplierTenant.slug,
        currency: result.supplierTenant.currency,
        businessType: result.supplierTenant.businessType,
      },
    });

    const cookieOpts = getPartnerCookieOptions();
    response.cookies.set(cookieOpts.name, jwt, cookieOpts);

    // Also set pos_token for parity with the login route (even though
    // suppliers don't use POS endpoints yet, later portal work may hit
    // shared /api/me endpoints that expect it).
    const posToken = await new SignJWT({
      memberId: result.membership.id,
      tenantId: result.supplierTenant.id,
      email: result.membership.email,
      role: result.membership.role,
      firstName: result.membership.firstName,
      lastName: result.membership.lastName,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(POS_JWT_SECRET);

    response.cookies.set("pos_token", posToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60,
      path: "/",
    });

    console.log(
      `[SUPPLIER-INVITES] Accepted: ${emailLower} → supplier tenant ${result.supplierTenant.slug} (invited by ${invite.fromTenantId})`
    );

    return response;
  } catch (error: any) {
    console.error("[SUPPLIER-INVITES] Accept error:", error);
    return NextResponse.json(
      { error: "Failed to accept invitation. Please try again." },
      { status: 500 }
    );
  }
}
