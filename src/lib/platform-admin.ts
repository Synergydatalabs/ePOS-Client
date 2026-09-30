// Platform admin auth — gates the /platform/* routes.
//
// v1: env-var email allowlist. `PLATFORM_ADMIN_EMAILS` is a comma-separated
// list of emails (case-insensitive). Anyone authenticated (partner JWT or
// Cognito session) whose email matches the allowlist can hit /platform
// routes. Anyone else gets a 403.
//
// When we build a proper backend admin app (or add a PLATFORM_ADMIN role
// on Membership), swap this helper's internals and every caller stays the
// same.

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getPartnerSession } from "@/lib/partner-auth";

interface PlatformAdminOk {
  ok: true;
  email: string;
  authType: "cognito" | "partner";
}

interface PlatformAdminErr {
  ok: false;
  response: NextResponse;
}

function getAllowlist(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS || "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export async function requirePlatformAdmin(
  request: NextRequest
): Promise<PlatformAdminOk | PlatformAdminErr> {
  // Try Cognito first, then partner JWT — same pattern validateRequest uses.
  let email: string | null = null;
  let authType: "cognito" | "partner" = "cognito";

  const cognitoSession = await getServerSession(authOptions);
  if (cognitoSession?.user?.email) {
    email = cognitoSession.user.email.toLowerCase();
    authType = "cognito";
  } else {
    const partner = await getPartnerSession(request);
    if (partner?.email) {
      email = partner.email.toLowerCase();
      authType = "partner";
    }
  }

  if (!email) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const allow = getAllowlist();
  if (allow.size === 0) {
    // No allowlist configured — reject rather than fail-open. Prevents a
    // misconfigured environment from accidentally exposing platform admin
    // to every logged-in user.
    console.warn(
      "[PLATFORM-ADMIN] PLATFORM_ADMIN_EMAILS is empty — every request is being rejected."
    );
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Platform admin is not configured on this environment" },
        { status: 403 }
      ),
    };
  }

  if (!allow.has(email)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Not a platform admin" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, email, authType };
}

// Client-side / server-component helper — returns just the boolean so a
// layout can decide whether to render the shell. Never returns a 403 —
// that's the API's job.
export async function isPlatformAdmin(request: NextRequest): Promise<boolean> {
  const result = await requirePlatformAdmin(request);
  return result.ok;
}
