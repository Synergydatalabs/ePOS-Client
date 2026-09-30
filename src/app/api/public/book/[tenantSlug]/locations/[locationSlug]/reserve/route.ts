// ============================================================================
// POST /api/public/book/[tenantSlug]/locations/[locationSlug]/reserve
//
// Creates a Reservation from the public booking page. No auth — slug-based
// access. Rate-limited by IP (simple in-memory window) to prevent abuse.
//
// On success:
//   - Reservation created with source="WEBSITE"
//   - Linked to GuestProfile by email/phone if one exists, else created
//   - Fire-and-forget WhatsApp/SMS confirmation (whichever channel is configured)
//
// Returns the bare minimum the page needs for the confirmation screen.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { sendSms } from "@/lib/sms/client";
import { sendWhatsApp } from "@/lib/whatsapp/client";
import { reservationConfirmationMessage } from "@/lib/sms/templates";
import { reservationConfirmationText } from "@/lib/whatsapp/templates";
import { resolveMetaCredentialsForTenant } from "@/lib/whatsapp/credentials";
import { computeAvailability } from "@/lib/booking/availability";
import {
  resolveDurationMinutes,
  checkOverbooking,
} from "@/lib/reservation-capacity";
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";

// ----------------------------------------------------------------------------
// Lightweight IP rate-limit: 5 reservations per IP per hour. Resets on
// process restart, which is fine — anti-abuse, not anti-DoS. For real DoS
// protection, fronting CDN / WAF should rate-limit too.
// ----------------------------------------------------------------------------

const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 60 * 1000;
const ipHits = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const arr = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (arr.length >= IP_LIMIT) return false;
  arr.push(now);
  ipHits.set(ip, arr);
  return true;
}

// ----------------------------------------------------------------------------

const bodySchema = z.object({
  customerName: z.string().trim().min(1).max(200),
  customerPhone: z.string().trim().min(7).max(30),
  customerEmail: z.string().trim().email().max(255).optional().or(z.literal("")),
  partySize: z.number().int().min(1).max(50),
  bookedFor: z.string().datetime(),         // ISO from slot.startsAt
  specialOccasion: z.string().trim().max(50).optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  // Honey-pot: a hidden field bots fill in. Real users leave it empty.
  website: z.string().max(0).optional(),
  // Phase E R5: reCAPTCHA token from the client.
  recaptchaToken: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; locationSlug: string }> }
) {
  const { tenantSlug, locationSlug } = await params;

  // Rate limit
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please try again in an hour." },
      { status: 429 }
    );
  }

  // Parse + validate
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: "Invalid input", details: err?.errors ?? String(err) },
      { status: 400 }
    );
  }

  // Honey-pot caught a bot
  if (body.website) {
    // Pretend success — don't reveal we detected it
    return NextResponse.json({
      success: true,
      reservation: { id: "decoy", confirmationCode: "OK000000" },
    });
  }

  // Phase E R5: reCAPTCHA verify before any DB work. Honey-pot catches
  // the dumb bots, reCAPTCHA catches the smart ones.
  const recaptcha = await verifyRecaptcha({
    token: body.recaptchaToken || "",
    ip: ipFromRequest(request),
    expectedAction: "book_reservation",
  });
  if (!recaptcha.ok) {
    console.warn(`[public reserve] reCAPTCHA rejected (${recaptcha.reason})`);
    return NextResponse.json(
      { success: false, error: "Verification failed. Please try again." },
      { status: 403 }
    );
  }

  // Resolve location via slug pair
  const location = await prisma.location.findFirst({
    where: {
      publicBookingSlug: locationSlug,
      status: "ACTIVE",
      publicBookingEnabled: true,
      tenant: { slug: tenantSlug, publicBookingEnabled: true },
    },
    include: { tenant: { select: { id: true, name: true } } },
  }).catch(() => null);

  if (!location) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  // Re-check the slot is still available (someone else could have grabbed it
  // between the page render and form submit)
  const bookedDate = new Date(body.bookedFor);
  const dateStr = bookedDate.toISOString().slice(0, 10);
  const stillAvailable = (await computeAvailability({
    locationId: location.id,
    date: dateStr,
    partySize: body.partySize,
  })).some((s) => Math.abs(new Date(s.startsAt).getTime() - bookedDate.getTime()) < 60_000);

  if (!stillAvailable) {
    return NextResponse.json(
      {
        success: false,
        error: "That time was just booked by someone else. Please pick another slot.",
        retry: true,
      },
      { status: 409 }
    );
  }

  // Link to existing GuestProfile by phone or email
  let guestProfileId: string | undefined;
  try {
    const existing = await prisma.guestProfile.findFirst({
      where: {
        tenantId: location.tenant.id,
        OR: [
          { phone: body.customerPhone },
          ...(body.customerEmail ? [{ email: body.customerEmail }] : []),
        ],
      },
      select: { id: true },
    });
    if (existing) {
      guestProfileId = existing.id;
    } else {
      const [firstName, ...rest] = body.customerName.trim().split(/\s+/);
      const created = await prisma.guestProfile.create({
        data: {
          tenantId: location.tenant.id,
          firstName: firstName || body.customerName,
          lastName: rest.join(" ") || null,
          phone: body.customerPhone,
          email: body.customerEmail || null,
        },
      });
      guestProfileId = created.id;
    }
  } catch (err) {
    console.error("[public reserve] guest profile lookup failed:", err);
    // Non-fatal — proceed without guest profile link
  }

  // Phase E R2: server-authoritative duration + overbooking check.
  // Customer-side flow can't be trusted to pass a duration, and the old
  // schema default (90) was one-size-fits-all — a party of 8 booked next
  // to another party of 8 could double-book the whole restaurant.
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId: location.tenantId },
    select: {
      partySizeDurationMap: true,
      reservationTurnBufferMinutes: true,
    },
  });
  const effectiveDuration = resolveDurationMinutes(
    body.partySize,
    settings?.partySizeDurationMap
  );
  const turnBuffer = settings?.reservationTurnBufferMinutes ?? 15;

  const capacity = await checkOverbooking({
    locationId: location.id,
    bookedFor: bookedDate,
    durationMinutes: effectiveDuration,
    partySize: body.partySize,
    turnBufferMinutes: turnBuffer,
  });
  if (!capacity.ok) {
    return NextResponse.json(
      {
        error:
          "This time is no longer available. Please pick a different slot.",
        details: capacity.reason,
      },
      { status: 409 }
    );
  }

  // Create reservation
  const reservation = await prisma.reservation.create({
    data: {
      locationId: location.id,
      guestProfileId,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      customerEmail: body.customerEmail || null,
      partySize: body.partySize,
      bookedFor: bookedDate,
      estimatedDurationMinutes: effectiveDuration,
      source: "WEBSITE",
      specialOccasion: body.specialOccasion || null,
      notes: body.notes || null,
      status: "CONFIRMED",
    },
    select: {
      id: true,
      customerName: true,
      partySize: true,
      bookedFor: true,
      status: true,
    },
  });

  // Fire-and-forget confirmation message — channel preference: WhatsApp if
  // available, else SMS. Never block the response on this.
  void (async () => {
    const ctx = {
      restaurantName: location.tenant.name,
      customerName: body.customerName,
      partySize: body.partySize,
      bookedFor: bookedDate,
    };
    const hasWa = !!(await resolveMetaCredentialsForTenant(location.tenant.id));
    if (hasWa) {
      await sendWhatsApp({
        kind: "text",
        tenantId: location.tenant.id,
        to: body.customerPhone,
        body: reservationConfirmationText(ctx),
        category: "reservation_confirm_public",
      });
    } else {
      await sendSms({
        tenantId: location.tenant.id,
        to: body.customerPhone,
        body: reservationConfirmationMessage(ctx),
        category: "reservation_confirm_public",
      });
    }
    // Mark confirmation sent so the cron doesn't duplicate
    await prisma.reservation.update({
      where: { id: reservation.id },
      data: { confirmationSentAt: new Date() },
    }).catch(() => {});
  })().catch((err) =>
    console.error("[public reserve] confirmation send failed:", err)
  );

  // Generate a short confirmation code for display
  const confirmationCode = reservation.id.slice(0, 8).toUpperCase();

  return NextResponse.json({
    success: true,
    reservation: {
      id: reservation.id,
      confirmationCode,
      customerName: reservation.customerName,
      partySize: reservation.partySize,
      bookedFor: reservation.bookedFor,
      status: reservation.status,
      locationName: location.name,
      restaurantName: location.tenant.name,
    },
  });
}
