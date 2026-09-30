// POST /api/mobile/auth/login
//
// Mobile-specific login endpoint. Returns the JWT in the response BODY
// (not as a cookie) so the Android/iOS app can store it in its own
// secure storage (Keychain / EncryptedSharedPreferences) and send it
// back on subsequent requests as `Authorization: Bearer <jwt>`.
//
// Reuses the same password / lockout logic as the web partner login;
// this endpoint is a slim wrapper around that. Multi-tenant users
// receive the tenant picker in the same shape web uses — the mobile
// app just renders it locally instead of via a dropdown.
//
// Deliberately skips reCAPTCHA: mobile apps can't render Google's v3
// widget, and device attestation (Play Integrity / App Attest) is a
// stronger signal we'll wire in later. Password + lockout still gate.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  verifyPassword,
  isAccountLocked,
  getLockoutTime,
  MAX_LOGIN_ATTEMPTS,
} from "@/lib/password";
import { signPartnerToken } from "@/lib/partner-auth";

interface LoginBody {
  email?: string;
  password?: string;
  tenantId?: string;
}

export async function POST(request: NextRequest) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const tenantId = body.tenantId?.trim();

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  // Find ALL memberships for this email so a single account with access to
  // multiple tenants shows a picker rather than silently locking them to one.
  const memberships = await prisma.membership.findMany({
    where: {
      email,
      userSub: { startsWith: "local-" },
      status: "ACTIVE",
      tenant: { authProvider: "local", status: "ACTIVE" },
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
          businessType: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (memberships.length === 0) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Password check + lockout — same rules as web. We use the first
  // membership's hash + lockout state; a shared login across tenants
  // uses one password so this holds regardless of which tenant is picked.
  const primary = memberships[0];
  const lockStatus = isAccountLocked(primary.loginAttempts, primary.lockedUntil);
  if (lockStatus.locked) {
    return NextResponse.json({ error: lockStatus.message }, { status: 423 });
  }
  if (!primary.passwordHash) {
    return NextResponse.json(
      { error: "Password not set. Please use the reset password flow." },
      { status: 401 }
    );
  }

  const passwordValid = await verifyPassword(password, primary.passwordHash);
  if (!passwordValid) {
    const newAttempts = primary.loginAttempts + 1;
    const updateData: Record<string, unknown> = { loginAttempts: newAttempts };
    if (newAttempts >= MAX_LOGIN_ATTEMPTS) updateData.lockedUntil = getLockoutTime();
    await prisma.membership.updateMany({
      where: { email, userSub: { startsWith: "local-" } },
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

  // Multi-tenant picker — app renders a list of tenants and calls this
  // endpoint again with the chosen tenantId to complete login.
  if (memberships.length > 1 && !tenantId) {
    await prisma.membership.updateMany({
      where: { email, userSub: { startsWith: "local-" } },
      data: { loginAttempts: 0, lockedUntil: null },
    });
    return NextResponse.json({
      success: true,
      multiTenant: true,
      tenants: memberships.map((m) => ({
        id: m.tenant.id,
        name: m.tenant.name,
        slug: m.tenant.slug,
        businessType: m.tenant.businessType,
        role: m.role,
      })),
    });
  }

  // Single tenant (or user picked one) — issue the JWT.
  const membership = tenantId
    ? memberships.find((m) => m.tenantId === tenantId) || memberships[0]
    : memberships[0];

  await prisma.membership.update({
    where: { id: membership.id },
    data: { loginAttempts: 0, lockedUntil: null, lastActiveAt: new Date() },
  });

  // Optional branding — mobile app can render the tenant's logo + colors
  // on login-success + subsequent screens if the tenant customized them.
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId: membership.tenant.id },
    select: {
      brandName: true,
      brandLogoUrl: true,
      brandPrimaryColor: true,
      brandAccentColor: true,
    },
  });

  const token = await signPartnerToken({
    memberId: membership.id,
    tenantId: membership.tenantId,
    email: membership.email,
    role: membership.role,
    firstName: membership.firstName,
    lastName: membership.lastName,
  });

  return NextResponse.json({
    success: true,
    token,
    // 24h — same as partner_token TTL. App should refresh before expiry
    // (call /api/mobile/auth/session; if 401, force re-login).
    expiresInSeconds: 24 * 60 * 60,
    user: {
      memberId: membership.id,
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
          name: settings.brandName,
          logoUrl: settings.brandLogoUrl,
          primaryColor: settings.brandPrimaryColor,
          accentColor: settings.brandAccentColor,
        }
      : null,
  });
}
