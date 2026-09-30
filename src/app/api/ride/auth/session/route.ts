import { NextRequest, NextResponse } from "next/server";
import { getRideSession, getRideCookieOptions, RIDE_COOKIE_NAME } from "@/lib/ride-auth";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getRideSession(request);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Get fresh customer data
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT rc.id, rc.name, rc.email, rc.phone, rc.total_trips, rc.rating,
              rc.default_payment_method, rc.saved_addresses,
              t.name AS tenant_name, t.slug AS tenant_slug, t.currency
       FROM ride_customers rc
       JOIN tenants t ON rc.tenant_id = t.id
       WHERE rc.id = $1::uuid AND rc.is_active = true`,
      session.customerId
    );

    if (!rows.length) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }

    const c = rows[0];
    return NextResponse.json({
      authenticated: true,
      customer: {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        totalTrips: c.total_trips,
        rating: c.rating ? Number(c.rating) : 5.0,
        defaultPaymentMethod: c.default_payment_method,
        savedAddresses: c.saved_addresses || [],
        tenantId: session.tenantId,
        tenantName: c.tenant_name,
        tenantSlug: c.tenant_slug,
        currency: c.currency || "CAD",
      },
    });
  } catch (error) {
    console.error("[RIDE] Session error:", error);
    return NextResponse.json({ authenticated: false }, { status: 500 });
  }
}

// DELETE — logout
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(RIDE_COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return res;
}
