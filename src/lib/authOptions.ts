import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import prisma from "./prisma";
import { signIn as cognitoSignIn } from "./cognito";

const isProduction = process.env.NODE_ENV === "production";

// Session timeout - 24 hours
const SESSION_MAX_AGE = 24 * 60 * 60;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "Email & Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mfaCode: { label: "MFA Code", type: "text" },
        mfaType: { label: "MFA Type", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        try {
          console.log(`🔐 [iTAP] Sign in attempt: ${credentials.email}`);

          // Authenticate with Cognito directly
          const result = await cognitoSignIn({
            email: credentials.email,
            password: credentials.password,
            mfaCode: credentials.mfaCode || undefined,
            mfaType: (credentials.mfaType as "TOTP" | "SMS") || undefined,
          });

          // Handle MFA requirement
          if (result.needsMfa) {
            console.log(`🔐 [iTAP] MFA required for: ${credentials.email}`);
            throw new Error("MFA_REQUIRED");
          }

          if (!result.success) {
            throw new Error(result.error || "Authentication failed");
          }

          if (!result.user || !result.tokens) {
            throw new Error("Invalid response from authentication");
          }

          console.log(`✅ [iTAP] Sign in successful: ${credentials.email}`);

          // Return user object for NextAuth
          return {
            id: result.user.sub,
            email: result.user.email,
            name: result.user.name,
            sub: result.user.sub,
            accessToken: result.tokens.accessToken,
            idToken: result.tokens.idToken,
            refreshToken: result.tokens.refreshToken,
          };
        } catch (error: any) {
          console.error("[iTAP Auth] Cognito auth error:", error.message);
          throw error;
        }
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE,
    updateAge: 60,
  },

  jwt: {
    maxAge: SESSION_MAX_AGE,
  },

  callbacks: {
    async jwt({ token, user, account }) {
      // On initial sign in, add user data to token
      if (account?.provider === "credentials" && user) {
        return {
          ...token,
          id: user.id,
          sub: user.id,
          email: user.email,
          name: user.name,
          cognitoSub: (user as any).sub,
          accessToken: (user as any).accessToken,
          idToken: (user as any).idToken,
          refreshToken: (user as any).refreshToken,
          loginTime: Date.now(),
          accessTokenExpires: Date.now() + SESSION_MAX_AGE * 1000,
        };
      }

      // Check session expiry (24 hours from login)
      const loginTime = token.loginTime as number;
      if (loginTime && Date.now() - loginTime > SESSION_MAX_AGE * 1000) {
        console.log("⏰ [iTAP] Session expired (24 hours)");
        return { ...token, expired: true };
      }

      return token;
    },

    async session({ session, token }) {
      if ((token as any).expired) {
        return {
          ...session,
          user: undefined,
          expired: true,
          error: "SessionExpired",
        };
      }

      if (token) {
        (session as any).accessToken = token.accessToken;
        (session as any).idToken = token.idToken;
        (session as any).userId = token.id || token.sub;
        (session as any).loginTime = token.loginTime;

        session.user = {
          id: (token.id || token.sub) as string,
          email: token.email as string,
          name: token.name as string,
        };

        // Check POS membership and subscription status
        try {
          const memberships = await prisma.membership.findMany({
            where: {
              userSub: token.sub as string,
              status: "ACTIVE",
            },
            include: {
              tenant: {
                include: {
                  subscriptions: {
                    where: {
                      status: {
                        in: ["TRIAL", "ACTIVE"],
                      },
                    },
                    orderBy: {
                      createdAt: "desc",
                    },
                    take: 1,
                  },
                },
              },
            },
          });

          // Filter to only tenants with valid subscription
          const validMemberships = memberships.filter((m) => {
            const subscription = m.tenant.subscriptions[0];
            if (!subscription) return false;

            // Check if trial has expired
            if (subscription.status === "TRIAL" && subscription.trialEndsAt) {
              return new Date(subscription.trialEndsAt) > new Date();
            }

            return subscription.status === "ACTIVE";
          });

          (session as any).memberships = validMemberships.map((m) => ({
            id: m.id,
            tenantId: m.tenant.id,
            tenantName: m.tenant.name,
            tenantSlug: m.tenant.slug,
            role: m.role,
            subscriptionStatus: m.tenant.subscriptions[0]?.status || null,
          }));

          (session as any).hasPosAccess = validMemberships.length > 0;
        } catch (error) {
          console.error("[iTAP Auth] Error checking memberships:", error);
          (session as any).memberships = [];
          (session as any).hasPosAccess = false;
        }
      }
      return session;
    },

    async signIn({ user }) {
      // Allow sign in - access control is done at API/page level
      return true;
    },

    async redirect({ url, baseUrl }) {
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      try {
        const u = new URL(url);
        if (u.origin === baseUrl) return url;
      } catch {}
      return `${baseUrl}/dashboard`;
    },
  },

  pages: {
    signIn: "/signin",
    error: "/signin",
  },

  // Cookie configuration matching zashx-app
  cookies: {
    csrfToken: {
      name: isProduction ? "__Host-next-auth.csrf-token" : "next-auth.csrf-token",
      options: {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
      },
    },
    callbackUrl: {
      name: isProduction ? "__Secure-next-auth.callback-url" : "next-auth.callback-url",
      options: {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
      },
    },
    sessionToken: {
      name: isProduction ? "__Secure-next-auth.session-token" : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
        domain: isProduction ? ".zashx.com" : undefined,
      },
    },
    state: {
      name: isProduction ? "__Host-next-auth.state" : "next-auth.state",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
        maxAge: 900,
      },
    },
    pkceCodeVerifier: {
      name: isProduction ? "__Host-next-auth.pkce.code_verifier" : "next-auth.pkce.code_verifier",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isProduction,
        maxAge: 900,
      },
    },
  },

  useSecureCookies: isProduction,
  debug: !isProduction,
  secret: process.env.NEXTAUTH_SECRET,
};

// Extend NextAuth types
declare module "next-auth" {
  interface Session {
    accessToken?: string;
    idToken?: string;
    userId?: string;
    loginTime?: number;
    expired?: boolean;
    error?: string;
    memberships?: any[];
    hasPosAccess?: boolean;
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
    };
  }

  interface User {
    sub?: string;
    accessToken?: string;
    idToken?: string;
    refreshToken?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    sub?: string;
    cognitoSub?: string;
    accessToken?: string;
    idToken?: string;
    refreshToken?: string;
    loginTime?: number;
    accessTokenExpires?: number;
    expired?: boolean;
  }
}
