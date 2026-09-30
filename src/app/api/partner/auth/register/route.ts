// POST /api/partner/auth/register - Create new partner tenant with owner account
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { hashPassword, validatePassword } from "@/lib/password";
import { signPartnerToken, getPartnerCookieOptions } from "@/lib/partner-auth";
// Phase I #4 (2026-09-11): tenant approval flow (see register-supplier
// route + src/lib/tenant-verification.ts for the full design).
import { ensureVerificationRow, sendOtp } from "@/lib/tenant-verification";
import { addDays } from "date-fns";
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";

const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || "14");

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 50);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      businessName,
      email,
      phone,
      password,
      firstName,
      lastName,
      currency,
      timezone,
      businessType,
      recaptchaToken,
    } = body;

    // Signup is a common credential-stuffing target — but blocking on a
    // mis-registered site key would kill legit new-tenant onboarding.
    // Soft-fail: log and continue. Set RECAPTCHA_ENFORCE_AUTH=1 to make
    // this a hard 403 in prod.
    const rc = await verifyRecaptcha({
      token: recaptchaToken || "",
      ip: ipFromRequest(request),
      expectedAction: "partner_signup",
    });
    if (!rc.ok) {
      // Phase I #4 (2026-09-11): reCAPTCHA HARD-FAIL — no bypass.
      console.warn(`[partner register] reCAPTCHA rejected (${rc.reason})`);
      return NextResponse.json(
        { error: "Verification failed. Please refresh the page and try again." },
        { status: 403 }
      );
    }

    // Validate required fields — Phase I #4 (2026-09-12): phone joins
    // the required set so the verification wizard can fire the phone
    // OTP after account creation.
    if (!businessName || !email || !password || !firstName || !phone) {
      return NextResponse.json(
        { error: "Business name, first name, email, phone, and password are required" },
        { status: 400 }
      );
    }

    // Normalize phone to digits only — same shape the WhatsApp/SMS
    // clients expect. Minimum 7 digits is the loosest sanity check
    // that catches empty-ish input without rejecting valid short-code
    // international formats.
    const phoneDigits = String(phone).replace(/\D/g, "");
    if (phoneDigits.length < 7) {
      return NextResponse.json(
        { error: "Enter a valid phone number" },
        { status: 400 }
      );
    }

    if (businessName.trim().length < 2) {
      return NextResponse.json(
        { error: "Business name must be at least 2 characters" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailLower = email.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    // Validate password strength
    const passwordError = validatePassword(password);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    // Check if email already exists for a local-auth tenant
    const existingMembership = await prisma.membership.findFirst({
      where: {
        email: emailLower,
        userSub: `local-${emailLower}`,
        role: "TENANT_OWNER",
      },
    });

    if (existingMembership) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // Generate unique slug
    let slug = generateSlug(businessName);
    let slugExists = await prisma.tenant.findUnique({ where: { slug } });
    let attempts = 0;

    while (slugExists && attempts < 10) {
      slug = `${generateSlug(businessName)}-${Math.random().toString(36).substring(2, 6)}`;
      slugExists = await prisma.tenant.findUnique({ where: { slug } });
      attempts++;
    }

    if (slugExists) {
      return NextResponse.json(
        { error: "Could not generate unique identifier. Please try a different business name." },
        { status: 400 }
      );
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create everything in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Create tenant with local auth provider
      // Phase F #6 (2026-08-27): 'general' is the hub-signup default — a
      // plain business account with no POS lane pre-picked (buyer browses
      // the marketplace and can turn on POS from portal settings later).
      const validBusinessType = ["salon", "retail", "general"].includes(businessType) ? businessType : "restaurant";
      const tenant = await tx.tenant.create({
        data: {
          name: businessName.trim(),
          slug,
          currency: currency || "CAD",
          timezone: timezone || "America/Toronto",
          // Phase I #4 (2026-09-11): new signups land as PENDING_APPROVAL —
          // owner can log in but the portal layout guard renders a
          // "verify email → verify phone → under review" screen until
          // admin approves. Grandfathered legacy tenants stay ACTIVE.
          status: "PENDING_APPROVAL",
          authProvider: "local",
          businessType: validBusinessType,
        },
      });

      // 2. Create default location. Phase I #4 (2026-09-12): publicTourSlug
      // is a required unique field on Location — omitting it was the source
      // of the PrismaClientValidationError merchant signups hit yesterday.
      // Same slug shape the register-supplier route uses: <tenant-slug>-main
      // plus a short random suffix to keep it unique across tenants.
      const location = await tx.location.create({
        data: {
          tenantId: tenant.id,
          name: "Main Location",
          isDefault: true,
          status: "ACTIVE",
          country: "CA",
          publicTourSlug: `${tenant.slug}-main-${Math.random().toString(36).substring(2, 8)}`,
        },
      });

      // 3. Create owner membership with DB auth
      const membership = await tx.membership.create({
        data: {
          tenantId: tenant.id,
          userSub: `local-${emailLower}`,
          email: emailLower,
          firstName: firstName.trim(),
          lastName: lastName?.trim() || null,
          role: "TENANT_OWNER",
          status: "ACTIVE",
          passwordHash,
          mustChangePassword: false,
          activatedAt: new Date(),
          lastActiveAt: new Date(),
        },
      });

      // 4. Create trial subscription
      const subscription = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          plan: "trial",
          status: "TRIAL",
          monthlyPrice: 0,
          trialEndsAt: addDays(new Date(), TRIAL_DAYS),
        },
      });

      // 5. Create default settings (conditional on business type)
      const isSalon = validBusinessType === "salon";
      const isRetail = validBusinessType === "retail";
      const isRestaurant = validBusinessType === "restaurant";
      // 'general' hub buyer: nothing POS-y turned on. They land in the
      // marketplace, not on a kitchen ticket or a table map.
      const isGeneral = validBusinessType === "general";
      const settings = await tx.tenantSettings.create({
        data: {
          tenantId: tenant.id,
          taxEnabled: true,
          taxRate: 13.0,
          taxLabel: "HST",
          tipEnabled: !isRetail && !isGeneral, // Retail + general don't need tips
          tipPresets: [15, 18, 20],
          tipCustomEnabled: !isRetail && !isGeneral,
          customerDisplayEnabled: isRestaurant,
          showOrderDetails: true,
          kitchenDisplayEnabled: isRestaurant,
          tableOrderingEnabled: isRestaurant,
          appointmentBookingEnabled: isSalon,
          walkInEnabled: isSalon,
          bufferTimeMinutes: isSalon ? 15 : 0,
          brandName: businessName.trim(),
          // Phase I #4 (2026-09-12): SMS on by default so verification
          // OTPs (which fall back from WhatsApp) can actually deliver.
          // The check in lib/sms/client.ts refuses at the tenant level
          // when this is false, and a brand-new tenant that can't even
          // receive an OTP text can never complete signup.
          smsEnabled: true,
        },
      });

      return { tenant, location, membership, subscription, settings };
    });

    // Phase I #4 (2026-09-12): tenant approval flow. Both email and
    // phone OTPs fire in parallel — the verify wizard drives the user
    // through them in whichever order they prefer. contactPhone is
    // normalized to digits only so the WhatsApp/SMS senders don't have
    // to re-parse it.
    try {
      await ensureVerificationRow(result.tenant.id, emailLower, phoneDigits);
      const [emailOtp, phoneOtp] = await Promise.all([
        sendOtp(result.tenant.id, "email"),
        sendOtp(result.tenant.id, "phone"),
      ]);
      if (!emailOtp.ok) {
        console.warn(
          `[partner register] first email OTP failed for tenant ${result.tenant.id}: ${emailOtp.reason}`
        );
      }
      if (!phoneOtp.ok) {
        console.warn(
          `[partner register] first phone OTP failed for tenant ${result.tenant.id}: ${phoneOtp.reason}`
        );
      }
    } catch (err) {
      console.error(
        `[partner register] verification bootstrap failed for tenant ${result.tenant.id}:`,
        err
      );
    }

    // Sign JWT token
    const token = await signPartnerToken({
      memberId: result.membership.id,
      tenantId: result.tenant.id,
      email: result.membership.email,
      role: result.membership.role,
      firstName: result.membership.firstName,
      lastName: result.membership.lastName,
    });

    console.log(`[PARTNER] Registered: ${emailLower} → tenant ${result.tenant.slug}`);

    // Set cookie and return
    const response = NextResponse.json({
      success: true,
      user: {
        id: result.membership.id,
        email: result.membership.email,
        firstName: result.membership.firstName,
        lastName: result.membership.lastName,
        role: result.membership.role,
      },
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        slug: result.tenant.slug,
        currency: result.tenant.currency,
        businessType: result.tenant.businessType,
      },
      subscription: {
        status: result.subscription.status,
        trialEndsAt: result.subscription.trialEndsAt,
      },
    });

    const cookieOpts = getPartnerCookieOptions();
    response.cookies.set(cookieOpts.name, token, cookieOpts);

    return response;
  } catch (error: any) {
    console.error("[PARTNER] Register error:", error);
    return NextResponse.json(
      { error: "Registration failed. Please try again." },
      { status: 500 }
    );
  }
}
