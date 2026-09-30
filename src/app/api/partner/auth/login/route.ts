// POST /api/partner/auth/login - Partner owner/admin login (DB-based auth)
// Supports multi-tenant: if one email has memberships in multiple tenants,
// returns a tenant list for the user to pick from.
import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";
import prisma from "@/lib/prisma";
import {
  verifyPassword,
  isAccountLocked,
  getLockoutTime,
  MAX_LOGIN_ATTEMPTS,
} from "@/lib/password";
import { signPartnerToken, getPartnerCookieOptions } from "@/lib/partner-auth";
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";

const POS_JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, tenantId, recaptchaToken } = body;

    // Phase E R5-style gate. Fails open in dev (no RECAPTCHA_SECRET_KEY);
    // in prod the token must verify or the login is refused before we
    // even touch the DB — cheapest possible bot filter.
    // reCAPTCHA runs for signal, not as a hard gate — password + MFA +
    // per-account lockout already guard this endpoint, and blocking on
    // a mis-registered site key would lock legitimate users (including
    // demo staff) out of their own tenant. We log a warning so a bot
    // storm still shows up in the logs. Flip RECAPTCHA_ENFORCE_AUTH=1
    // in the env to make the gate hard (403 on any verify failure).
    const rc = await verifyRecaptcha({
      token: recaptchaToken || "",
      ip: ipFromRequest(request),
    });
    if (!rc.ok) {
      // Phase I #4 (2026-09-11): reCAPTCHA HARD-FAIL — with an ops
      // escape hatch. Set RECAPTCHA_BYPASS=1 in the env when Google is
      // returning `invalid-keys` (domain not yet in the reCAPTCHA
      // console) or during a Google outage — lets legit staff back in
      // while the root cause is being fixed. UNSET as soon as it's
      // resolved. Bypass is logged loudly so it's visible in ops
      // logs and doesn't get forgotten.
      console.warn(`[partner login] reCAPTCHA rejected (${rc.reason})`);
      if (process.env.RECAPTCHA_BYPASS === "1") {
        console.warn("[partner login] RECAPTCHA_BYPASS=1 — allowing anyway. UNSET WHEN FIXED.");
      } else {
        return NextResponse.json(
          { error: "Verification failed. Please refresh the page and try again." },
          { status: 403 }
        );
      }
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    // Find ALL memberships for this email across tenants.
    // Phase I #4 (2026-09-12): removed the tenant.status: "ACTIVE" filter
    // so we can distinguish "no such user" (still 401) from "user exists
    // but tenant is PENDING_APPROVAL / REJECTED" (403 with a clear
    // message). The old filter conflated both into "invalid password",
    // which is what confused Ahmad after his test signup. Password is
    // still verified below before we reveal the tenant status.
    const memberships = await prisma.membership.findMany({
      where: {
        email: email.toLowerCase(),
        userSub: { startsWith: "local-" },
        status: "ACTIVE",
        tenant: {
          authProvider: "local",
        },
        ...(tenantId ? { tenantId } : {}),
      },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            currency: true,
            status: true,
            authProvider: true,
            businessType: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    if (memberships.length === 0) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Use the first membership for password verification
    const primaryMembership = memberships[0];

    // Check account lockout
    const lockStatus = isAccountLocked(primaryMembership.loginAttempts, primaryMembership.lockedUntil);
    if (lockStatus.locked) {
      return NextResponse.json(
        { error: lockStatus.message },
        { status: 423 }
      );
    }

    // Verify password
    if (!primaryMembership.passwordHash) {
      return NextResponse.json(
        { error: "Password not set. Please use the reset password flow." },
        { status: 401 }
      );
    }

    const passwordValid = await verifyPassword(password, primaryMembership.passwordHash);

    if (!passwordValid) {
      const newAttempts = primaryMembership.loginAttempts + 1;
      const updateData: Record<string, unknown> = { loginAttempts: newAttempts };

      if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
        updateData.lockedUntil = getLockoutTime();
      }

      // Update login attempts on all memberships for this email
      await prisma.membership.updateMany({
        where: { email: email.toLowerCase(), userSub: { startsWith: "local-" } },
        data: updateData,
      });

      const attemptsLeft = MAX_LOGIN_ATTEMPTS - newAttempts;
      return NextResponse.json(
        {
          error:
            attemptsLeft > 0
              ? `Invalid password. ${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} remaining.`
              : "Account locked due to too many failed attempts.",
        },
        { status: 401 }
      );
    }

    // Password valid — Phase I #4 (2026-09-12): filter by tenant status
    // AFTER password verification (never before) so we don't leak "this
    // tenant exists" to attackers. If none of the user's tenants are
    // ACTIVE, return the specific reason so they know to complete
    // verification or contact support instead of retrying their password.
    const active = memberships.filter((m) => m.tenant.status === "ACTIVE");
    const pending = memberships.filter((m) => m.tenant.status === "PENDING_APPROVAL");
    const rejected = memberships.filter((m) => m.tenant.status === "REJECTED");
    const suspended = memberships.filter((m) => m.tenant.status === "SUSPENDED");

    if (active.length === 0) {
      // Reset failed-attempt counters — the password was right, we're
      // just refusing on account state, not credentials.
      await prisma.membership.updateMany({
        where: { email: email.toLowerCase(), userSub: { startsWith: "local-" } },
        data: { loginAttempts: 0, lockedUntil: null },
      });

      if (pending.length > 0) {
        return NextResponse.json(
          {
            error:
              "Your account is awaiting approval. Please complete email and phone verification, then wait for admin approval.",
            reason: "pending_approval",
            // The verify page reads status from the session cookie the
            // client already holds after signup, so no tenant id is
            // needed in the URL — but we still hint where to go.
            redirect: "/partner/verify",
          },
          { status: 403 }
        );
      }
      if (rejected.length > 0) {
        return NextResponse.json(
          {
            error:
              "Your account application was not approved. Please contact support if you believe this is a mistake.",
            reason: "rejected",
          },
          { status: 403 }
        );
      }
      if (suspended.length > 0) {
        return NextResponse.json(
          {
            error:
              "Your account has been suspended. Please contact support.",
            reason: "suspended",
          },
          { status: 403 }
        );
      }
      // CANCELLED or any other terminal state — generic message
      return NextResponse.json(
        {
          error: "This account is no longer active. Please contact support.",
          reason: "inactive",
        },
        { status: 403 }
      );
    }

    // Only consider ACTIVE tenants for the rest of the login flow —
    // suspended/rejected/pending shouldn't appear in the multi-tenant
    // picker even if the user has one healthy tenant alongside them.
    const eligibleMemberships = active;

    // Password valid — if multiple tenants and no tenantId specified, return picker
    if (eligibleMemberships.length > 1 && !tenantId) {
      // Reset attempts on all memberships
      await prisma.membership.updateMany({
        where: { email: email.toLowerCase(), userSub: { startsWith: "local-" } },
        data: { loginAttempts: 0, lockedUntil: null },
      });

      const BUSINESS_ICONS: Record<string, string> = {
        restaurant: "solar:chef-hat-bold",
        salon: "solar:scissors-bold",
        retail: "solar:bag-4-bold",
        cab: "solar:car-bold",
      };

      return NextResponse.json({
        success: true,
        multiTenant: true,
        tenants: eligibleMemberships.map((m) => ({
          id: m.tenant.id,
          name: m.tenant.name,
          slug: m.tenant.slug,
          businessType: m.tenant.businessType,
          role: m.role,
          icon: BUSINESS_ICONS[m.tenant.businessType || "restaurant"] || "solar:buildings-bold",
        })),
      });
    }

    // Single tenant (or tenant selected) — complete login
    const membership = tenantId
      ? eligibleMemberships.find((m) => m.tenantId === tenantId) || eligibleMemberships[0]
      : eligibleMemberships[0];

    // Reset attempts
    await prisma.membership.update({
      where: { id: membership.id },
      data: {
        loginAttempts: 0,
        lockedUntil: null,
        lastActiveAt: new Date(),
      },
    });

    // Get branding info
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId: membership.tenant.id },
      select: {
        brandName: true,
        brandLogoUrl: true,
        brandPrimaryColor: true,
        brandAccentColor: true,
        brandBackgroundColor: true,
      },
    });

    // Sign JWT
    const token = await signPartnerToken({
      memberId: membership.id,
      tenantId: membership.tenantId,
      email: membership.email,
      role: membership.role,
      firstName: membership.firstName,
      lastName: membership.lastName,
    });

    console.log(`[PARTNER] Login: ${email} at ${membership.tenant.name}`);

    const response = NextResponse.json({
      success: true,
      mustChangePassword: membership.mustChangePassword,
      user: {
        id: membership.id,
        email: membership.email,
        firstName: membership.firstName,
        lastName: membership.lastName,
        role: membership.role,
      },
      tenant: {
        id: membership.tenant.id,
        name: membership.tenant.name,
        slug: membership.tenant.slug,
        currency: membership.tenant.currency,
        businessType: membership.tenant.businessType,
      },
      branding: settings
        ? {
            brandName: settings.brandName,
            brandLogoUrl: settings.brandLogoUrl,
            brandPrimaryColor: settings.brandPrimaryColor,
            brandAccentColor: settings.brandAccentColor,
            brandBackgroundColor: settings.brandBackgroundColor,
          }
        : null,
    });

    const cookieOpts = getPartnerCookieOptions();
    response.cookies.set(cookieOpts.name, token, cookieOpts);

    // Also set pos_token so POS routes (counter, kitchen, orders, etc.) work seamlessly
    const posToken = await new SignJWT({
      memberId: membership.id,
      tenantId: membership.tenantId,
      email: membership.email,
      role: membership.role,
      firstName: membership.firstName,
      lastName: membership.lastName,
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

    return response;
  } catch (error: any) {
    console.error("[PARTNER] Login error:", error);
    return NextResponse.json(
      { error: "Login failed. Please try again." },
      { status: 500 }
    );
  }
}
