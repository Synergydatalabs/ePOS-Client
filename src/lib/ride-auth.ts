// Ride Customer Auth — JWT-based authentication for ride booking customers
import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

const RIDE_TOKEN_EXPIRY = "7d";
const RIDE_COOKIE_NAME = "ride_token";
const RIDE_COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export interface RideTokenPayload {
  customerId: string;
  tenantId: string;
  email: string;
  name: string;
  phone: string | null;
  authType: "ride_customer";
}

export interface RideSession {
  customerId: string;
  tenantId: string;
  email: string;
  name: string;
  phone: string | null;
}

export async function signRideToken(payload: Omit<RideTokenPayload, "authType">): Promise<string> {
  return new SignJWT({ ...payload, authType: "ride_customer" as const })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(RIDE_TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

export async function getRideSession(request: NextRequest): Promise<RideSession | null> {
  try {
    const token = request.cookies.get(RIDE_COOKIE_NAME)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, JWT_SECRET);
    const data = payload as unknown as RideTokenPayload;

    if (data.authType !== "ride_customer") return null;

    return {
      customerId: data.customerId,
      tenantId: data.tenantId,
      email: data.email,
      name: data.name,
      phone: data.phone,
    };
  } catch {
    return null;
  }
}

export function getRideCookieOptions(clear = false) {
  return {
    name: RIDE_COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: clear ? 0 : RIDE_COOKIE_MAX_AGE,
    path: "/",
  };
}

export { RIDE_COOKIE_NAME };
