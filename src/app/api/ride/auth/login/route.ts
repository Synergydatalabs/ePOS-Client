import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { compare } from "bcryptjs";
import { signRideToken, getRideCookieOptions } from "@/lib/ride-auth";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    // Find customer across all cab tenants
    const customers: any[] = await prisma.$queryRawUnsafe(
      `SELECT rc.*, t.name AS tenant_name, t.slug AS tenant_slug, t.business_type
       FROM ride_customers rc
       JOIN tenants t ON rc.tenant_id = t.id
       WHERE rc.email = $1 AND rc.is_active = true AND t.status = 'ACTIVE'
       ORDER BY rc.created_at ASC`,
      email.toLowerCase()
    );

    if (!customers.length) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const customer = customers[0];
    const valid = await compare(password, customer.password_hash);
    if (!valid) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

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
        tenantName: customer.tenant_name,
      },
    });

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
    console.error("[RIDE] Login error:", error);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
