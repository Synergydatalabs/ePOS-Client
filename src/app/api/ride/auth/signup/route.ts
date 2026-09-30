import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hash } from "bcryptjs";
import { signRideToken, getRideCookieOptions } from "@/lib/ride-auth";
// Phase I #4 (2026-09-12): reCAPTCHA hard-fail on the ride-customer
// signup, same policy as every other public signup path. Full email +
// phone OTP verification for ride customers needs a separate schema
// change on ride_customers (email_verified_at / phone_verified_at)
// and is tracked as its own task — this endpoint just picks up the
// bot filter for now.
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";

export async function POST(request: NextRequest) {
  try {
    const { name, email, phone, password, tenantSlug, recaptchaToken } =
      await request.json();

    const rc = await verifyRecaptcha({
      token: String(recaptchaToken || ""),
      ip: ipFromRequest(request),
      expectedAction: "ride_signup",
    });
    if (!rc.ok) {
      console.warn(`[ride signup] reCAPTCHA rejected (${rc.reason})`);
      return NextResponse.json(
        { error: "Verification failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    if (!name || !email || !password) {
      return NextResponse.json({ error: "Name, email, and password are required" }, { status: 400 });
    }

    // Find cab tenant by slug or default to first cab tenant
    const tenants: any[] = await prisma.$queryRawUnsafe(
      tenantSlug
        ? `SELECT id, name, slug FROM tenants WHERE slug = $1 AND business_type = 'cab' AND status = 'ACTIVE'`
        : `SELECT id, name, slug FROM tenants WHERE business_type = 'cab' AND status = 'ACTIVE' ORDER BY created_at ASC LIMIT 1`,
      ...(tenantSlug ? [tenantSlug] : [])
    );

    if (!tenants.length) {
      return NextResponse.json({ error: "Service not available" }, { status: 404 });
    }

    const tenant = tenants[0];

    // Check if email already exists for this tenant
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM ride_customers WHERE tenant_id = $1::uuid AND email = $2`,
      tenant.id, email.toLowerCase()
    );

    if (existing.length) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }

    const passwordHash = await hash(password, 10);
    const customerId = crypto.randomUUID();

    const created: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO ride_customers (id, tenant_id, name, email, phone, password_hash)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
       RETURNING id, name, email, phone, tenant_id`,
      customerId, tenant.id, name, email.toLowerCase(), phone || null, passwordHash
    );

    const customer = created[0];

    const token = await signRideToken({
      customerId: customer.id,
      tenantId: customer.tenant_id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
    });

    const res = NextResponse.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        tenantId: customer.tenant_id,
        tenantName: tenant.name,
      },
    }, { status: 201 });

    const cookie = getRideCookieOptions();
    res.cookies.set(cookie.name, token, {
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
      maxAge: cookie.maxAge,
      path: cookie.path,
    });

    return res;
  } catch (error) {
    console.error("[RIDE] Signup error:", error);
    return NextResponse.json({ error: "Signup failed" }, { status: 500 });
  }
}
