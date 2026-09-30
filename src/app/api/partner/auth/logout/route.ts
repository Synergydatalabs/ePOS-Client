// POST /api/partner/auth/logout - Partner logout
import { NextResponse } from "next/server";
import { getPartnerCookieOptions } from "@/lib/partner-auth";

export async function POST() {
  const response = NextResponse.json({
    success: true,
    message: "Logged out successfully",
  });

  const cookieOpts = getPartnerCookieOptions(true); // clear = true
  response.cookies.set(cookieOpts.name, "", cookieOpts);

  return response;
}
