import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "./authOptions";
import { getPartnerSession } from "./partner-auth";
import prisma from "./prisma";
import { MemberRole } from "@/types";

export interface AuthenticatedContext {
  userId: string;
  userEmail: string;
  tenantId: string;
  membership: {
    id: string;
    role: MemberRole;
  };
  authType: "cognito" | "partner" | "pos";
}

type RoleLevel = {
  [key in MemberRole]: number;
};

const ROLE_LEVELS: RoleLevel = {
  TENANT_OWNER: 100,
  POS_ADMIN: 80,
  POS_MANAGER: 60,
  POS_STAFF: 40,
  KITCHEN_STAFF: 20,
};

/**
 * Validate request has valid session and membership for the tenant.
 * Supports both Cognito (NextAuth) and partner (DB JWT) auth systems.
 */
export async function validateRequest(
  request: NextRequest,
  tenantId: string,
  requiredRole: MemberRole = "POS_STAFF"
): Promise<{ success: true; context: AuthenticatedContext } | { success: false; response: NextResponse }> {
  // Try Cognito/NextAuth session first
  const session = await getServerSession(authOptions);

  let userSub: string | null = null;
  let userEmail: string | null = null;
  let authType: "cognito" | "partner" = "cognito";

  if (session?.user?.id) {
    userSub = session.user.id;
    userEmail = session.user.email;
    authType = "cognito";
  } else {
    // Fallback: try partner JWT token
    const partnerSession = await getPartnerSession(request);
    if (partnerSession) {
      userSub = `local-${partnerSession.email}`;
      userEmail = partnerSession.email;
      authType = "partner";

      // Quick check: partner token's tenantId must match requested tenantId
      if (partnerSession.tenantId !== tenantId) {
        return {
          success: false,
          response: NextResponse.json(
            { error: "No active membership for this tenant" },
            { status: 403 }
          ),
        };
      }
    }
  }

  if (!userSub) {
    return {
      success: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  // Check membership for this tenant
  const membership = await prisma.membership.findFirst({
    where: {
      tenantId,
      userSub,
      status: "ACTIVE",
    },
    include: {
      tenant: {
        include: {
          subscriptions: {
            where: {
              status: { in: ["TRIAL", "ACTIVE"] },
            },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
    },
  });

  if (!membership) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "No active membership for this tenant" },
        { status: 403 }
      ),
    };
  }

  // Check subscription status
  const subscription = membership.tenant.subscriptions[0];
  if (!subscription) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "No active subscription" },
        { status: 403 }
      ),
    };
  }

  // Check trial expiration
  if (subscription.status === "TRIAL" && subscription.trialEndsAt) {
    if (new Date(subscription.trialEndsAt) < new Date()) {
      return {
        success: false,
        response: NextResponse.json(
          { error: "Trial has expired" },
          { status: 403 }
        ),
      };
    }
  }

  // Check role permission
  const userRoleLevel = ROLE_LEVELS[membership.role as MemberRole];
  const requiredRoleLevel = ROLE_LEVELS[requiredRole];

  if (userRoleLevel < requiredRoleLevel) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      ),
    };
  }

  return {
    success: true,
    context: {
      userId: userSub,
      userEmail: userEmail || membership.email,
      tenantId,
      membership: {
        id: membership.id,
        role: membership.role as MemberRole,
      },
      authType,
    },
  };
}

/**
 * Validate user is authenticated (no tenant context required)
 */
export async function validateAuth(): Promise<
  | { success: true; userId: string; email: string }
  | { success: false; response: NextResponse }
> {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      success: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return {
    success: true,
    userId: session.user.id,
    email: session.user.email,
  };
}

/**
 * Generate idempotency key for requests
 */
export function generateIdempotencyKey(prefix: string, ...parts: string[]): string {
  const data = [prefix, ...parts, Date.now()].join("-");
  return Buffer.from(data).toString("base64").substring(0, 32);
}
