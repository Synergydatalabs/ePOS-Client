// Partner Auth - DB-based authentication for white-label partner tenants
// Uses same pattern as POS staff auth but with 24hr sessions for dashboard access

import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.POS_JWT_SECRET || process.env.NEXTAUTH_SECRET || "pos-secret-key-change-in-production"
);

const PARTNER_TOKEN_EXPIRY = "24h";
const PARTNER_COOKIE_NAME = "partner_token";
const PARTNER_COOKIE_MAX_AGE = 24 * 60 * 60; // 24 hours in seconds

export interface PartnerTokenPayload {
  memberId: string;
  tenantId: string;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
  authType: "partner";
}

export interface PartnerSession {
  memberId: string;
  tenantId: string;
  email: string;
  role: string;
  firstName: string | null;
  lastName: string | null;
}

/**
 * Sign a new partner JWT token
 */
export async function signPartnerToken(payload: Omit<PartnerTokenPayload, "authType">): Promise<string> {
  return new SignJWT({ ...payload, authType: "partner" as const })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(PARTNER_TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

/**
 * Verify partner_token and return session data.
 * Accepts EITHER a cookie (web) OR an Authorization: Bearer header (mobile).
 * Same JWT format, same verify — the transport is the only difference.
 * This means every existing endpoint that calls getPartnerSession() is
 * automatically mobile-compatible with zero per-route changes.
 */
export async function getPartnerSession(request: NextRequest): Promise<PartnerSession | null> {
  try {
    // Cookie first (web dashboard, supplier portal). Then Bearer (mobile app).
    let token = request.cookies.get(PARTNER_COOKIE_NAME)?.value;
    if (!token) {
      const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
      if (authHeader?.toLowerCase().startsWith("bearer ")) {
        token = authHeader.slice(7).trim();
      }
    }
    if (!token) return null;

    const { payload } = await jwtVerify(token, JWT_SECRET);
    const data = payload as unknown as PartnerTokenPayload;

    // Ensure this is a partner token
    if (data.authType !== "partner") return null;

    return {
      memberId: data.memberId,
      tenantId: data.tenantId,
      email: data.email,
      role: data.role,
      firstName: data.firstName,
      lastName: data.lastName,
    };
  } catch {
    return null;
  }
}

/**
 * Cookie options for partner token
 */
export function getPartnerCookieOptions(clear = false) {
  return {
    name: PARTNER_COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: clear ? 0 : PARTNER_COOKIE_MAX_AGE,
    path: "/",
  };
}

export { PARTNER_COOKIE_NAME };
