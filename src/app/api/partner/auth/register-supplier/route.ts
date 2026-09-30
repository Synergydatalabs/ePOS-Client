// POST /api/partner/auth/register-supplier
// Public signup for suppliers who found us organically (i.e. NOT via a
// merchant's invite). Creates a fresh supplier tenant + profile stub +
// owner membership + partner JWT.
//
// Nearly identical to /api/supplier-invites/[token]/accept, minus the
// relationship-creation step (there's no inviting merchant yet). If we
// end up doing further work in both flows we should factor the common
// pieces into a helper — for Phase B v1 the duplication is small and
// keeps each entrypoint readable.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword, validatePassword } from "@/lib/password";
import { signPartnerToken, getPartnerCookieOptions } from "@/lib/partner-auth";
import { SignJWT } from "jose";
// Phase I #4 (2026-09-11): tenant approval flow. New signups land as
// PENDING_APPROVAL and receive an email OTP to start the verification
// chain. See src/lib/tenant-verification.ts for OTP + rate-limit rules.
import { ensureVerificationRow, sendOtp } from "@/lib/tenant-verification";
// Phase I #4 (2026-09-11): the /partner/signup client already sends a
// reCAPTCHA token on the Software Creator path — this endpoint was the
// only signup path that wasn't checking it server-side (the bot burner
// accounts got through partly because of this). HARD-FAIL: no bypass.
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";

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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Phase I #4 (2026-09-11): HARD-FAIL reCAPTCHA. Client already
    // sends the token via /partner/signup — burner-account signups
    // on 2026-09-11 got through because this endpoint wasn't
    // verifying it. Reject anything Google doesn't confirm.
    const rc = await verifyRecaptcha({
      token: String(body.recaptchaToken || ""),
      ip: ipFromRequest(request),
      expectedAction: "partner_signup",
    });
    if (!rc.ok) {
      console.warn(`[register-supplier] reCAPTCHA rejected (${rc.reason})`);
      return NextResponse.json(
        { error: "Verification failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    const companyName = String(body.companyName || "").trim();
    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim() || null;
    const email = String(body.email || "").toLowerCase().trim();
    const phone = String(body.phone || "").trim() || null;
    const password = String(body.password || "");
    // Optional at signup — supplier can pick country/currency now or edit
    // later from Settings. Sensible CA/CAD defaults.
    const currency = String(body.currency || "CAD").trim().toUpperCase().substring(0, 3);
    const timezone = String(body.timezone || "America/Toronto").trim();

    if (!companyName || companyName.length < 2) {
      return NextResponse.json({ error: "Company name is required (min 2 characters)" }, { status: 400 });
    }
    if (!firstName) {
      return NextResponse.json({ error: "First name is required" }, { status: 400 });
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Same email-already-taken check as the invite-accept path. If a
    // supplier already has an account, they should sign in first — we
    // don't silently attach a new tenant to an existing user.
    const existingLocalMembership = await prisma.membership.findFirst({
      where: {
        email,
        userSub: `local-${email}`,
      },
      select: { id: true },
    });
    if (existingLocalMembership) {
      return NextResponse.json(
        {
          error:
            "An account with this email already exists. Sign in first, then add a new business from your account.",
        },
        { status: 409 }
      );
    }

    // Slug collision retry — same pattern as the merchant register endpoint.
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

    const result = await prisma.$transaction(async (tx) => {
      // 1. Supplier tenant.
      // Phase I #4 (2026-09-11): status defaults to PENDING_APPROVAL —
      // the tenant is real and the owner can log in, but the portal
      // layout guard renders a "verify email → verify phone → under
      // review" screen instead of the normal UI until admin approves.
      // Grandfathered legacy tenants stay ACTIVE (they were created
      // before this flow existed).
      const supplierTenant = await tx.tenant.create({
        data: {
          name: companyName,
          slug,
          currency,
          timezone,
          status: "PENDING_APPROVAL",
          authProvider: "local",
          businessType: "supplier",
        },
      });

      // 2. SupplierProfile stub — supplier fills the rest via the portal
      // Settings page. onboardingStatus starts at NEW so the dashboard
      // shows the "get set up" checklist.
      await tx.supplierProfile.create({
        data: {
          tenantId: supplierTenant.id,
          displayName: companyName,
          legalName: companyName,
          contactEmail: email,
          contactPhone: phone,
          currency,
          onboardingStatus: "NEW",
        },
      });

      // 3. TenantSettings — partner-auth /session joins this row on every
      // request; missing rows cause an unhelpful null-branding UI.
      await tx.tenantSettings.create({
        data: {
          tenantId: supplierTenant.id,
          brandName: companyName,
          taxEnabled: false,
          tipEnabled: false,
          customerDisplayEnabled: false,
          kitchenDisplayEnabled: false,
          tableOrderingEnabled: false,
          // Phase I #4 (2026-09-12): SMS on by default so verification
          // OTPs can fall back from WhatsApp. See register/route.ts for
          // the full rationale.
          smsEnabled: true,
        },
      });

      // 4. Owner membership.
      const membership = await tx.membership.create({
        data: {
          tenantId: supplierTenant.id,
          userSub: `local-${email}`,
          email,
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

      return { supplierTenant, membership };
    });

    // Phase I #4 (2026-09-11): tenant approval flow.
    // Create the verification row and fire the FIRST email OTP synchronously.
    // Doing it OUTSIDE the create-tenant transaction on purpose: the OTP send
    // hits SES (external service) and we don't want a slow/failed SES call to
    // roll back a successfully-provisioned tenant. If SES fails, the row still
    // exists and the applicant can request a resend from the verify page.
    try {
      await ensureVerificationRow(result.supplierTenant.id, email, phone);
      // Fire email + phone OTPs in parallel — different transports, both
      // fire-and-forget. Applicant gets both codes within seconds and can
      // verify them in any order on the (soon-to-be-built) verify page.
      // Phone OTP is skipped when phone is null (merchant signup path).
      const sends = await Promise.all([
        sendOtp(result.supplierTenant.id, "email"),
        phone ? sendOtp(result.supplierTenant.id, "phone") : Promise.resolve({ ok: true, reason: undefined }),
      ]);
      if (!sends[0].ok) {
        console.warn(
          `[register-supplier] first email OTP failed for tenant ${result.supplierTenant.id}: ${sends[0].reason}`
        );
      }
      if (phone && !sends[1].ok) {
        console.warn(
          `[register-supplier] first phone OTP failed for tenant ${result.supplierTenant.id}: ${sends[1].reason}`
        );
      }
    } catch (err) {
      console.error(
        `[register-supplier] verification bootstrap failed for tenant ${result.supplierTenant.id}:`,
        err
      );
    }

    // Sign partner JWT — same shape as login/invite-accept so the shared
    // session hooks work without a special case.
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

    // pos_token parity — see comments in login/invite-accept for context.
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
      `[SUPPLIER-SIGNUP] Registered: ${email} → supplier tenant ${result.supplierTenant.slug}`
    );

    return response;
  } catch (error: any) {
    console.error("[SUPPLIER-SIGNUP] error:", error);
    return NextResponse.json(
      { error: "Registration failed. Please try again." },
      { status: 500 }
    );
  }
}
