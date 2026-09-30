import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
    };
    memberships: {
      id: string;
      tenantId: string;
      tenantName: string;
      tenantSlug: string;
      role: "TENANT_OWNER" | "POS_ADMIN" | "POS_MANAGER" | "POS_STAFF";
      subscriptionStatus: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | null;
    }[];
    hasPosAccess: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    sub: string;
    email: string;
    name: string;
  }
}
