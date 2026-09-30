// POST /api/public/book/[tenantSlug]/locations/[locationSlug]/appointment
//
// Creates a salon APPOINTMENT Order from the public booking flow.
// Mirrors the pattern of the public /reserve endpoint, but writes an
// Order (orderType=APPOINTMENT) instead of a Reservation. Everything
// the availability engine sees on the POS side is the same shape, so
// slots stay consistent whether a walk-in staffer or a customer books.
//
// Rate-limited by simple in-memory IP window (matches /reserve).
// Re-validates availability at commit time — a slot that goes away
// between load and submit is rejected with a 409 rather than
// double-booked.
//
// Payment: this MVP creates the appointment with paymentStatus=PENDING.
// Round 3b will wire the optional deposit-required flow into the same
// payment-provider abstraction the marketplace + QR-code POS use.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { computeAvailability } from "@/lib/appointment-availability";
import { sendSms } from "@/lib/sms/client";
import { verifyRecaptcha, ipFromRequest } from "@/lib/recaptcha";
import {
  computeDepositCents,
  depositSettingsFrom,
} from "@/lib/appointment-deposit";

const bookSchema = z.object({
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().min(7).max(30),
  customerEmail: z.string().email().max(255).optional(),
  serviceIds: z.array(z.string().uuid()).min(1).max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "time must be HH:MM"),
  technicianId: z.string().uuid().optional(),
  notes: z.string().max(1000).optional(),
  // Phase E R5: reCAPTCHA token from the client. Missing token is
  // accepted only when RECAPTCHA_SECRET_KEY isn't configured (dev
  // fallback in verifyRecaptcha logs a warning).
  recaptchaToken: z.string().optional(),
});

// --- rate limit (IP window) -----------------------------------------------
// Simple in-memory bucket; sufficient for public form spam. Real DoS
// protection lives in front of the app (WAF/CDN).
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 6;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function rateLimit(ip: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_MAX_PER_WINDOW) return false;
  bucket.count++;
  return true;
}

// --- next-per-location order number --------------------------------------
// Order.orderNumber is unique per (locationId, orderNumber). Public
// appointments use "APT-<yyyymmdd>-<sequence>" so operators can spot
// them at a glance. Falls back to a random tail on rare collisions.
async function nextAppointmentNumber(locationId: string, dateISO: string): Promise<string> {
  const dateCompact = dateISO.replace(/-/g, "");
  const prefix = `APT-${dateCompact}-`;
  const existing = await prisma.order.count({
    where: { locationId, orderNumber: { startsWith: prefix } },
  });
  return `${prefix}${String(existing + 1).padStart(3, "0")}`;
}

async function nextDisplayNumber(locationId: string): Promise<number> {
  // Order.displayNumber is a short 1-999 number for the kitchen/staff
  // board. Roll over past 999 back to 1 (rare — the day's orders reset).
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const max = await prisma.order.aggregate({
    where: { locationId, createdAt: { gte: startOfDay } },
    _max: { displayNumber: true },
  });
  const next = (max._max.displayNumber ?? 0) + 1;
  return next > 999 ? 1 : next;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; locationSlug: string }> }
) {
  const { tenantSlug, locationSlug } = await params;

  // Rate limit BEFORE we even parse the body — spammers hit this hard.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (!rateLimit(ip)) {
    return NextResponse.json(
      { success: false, error: "Too many requests. Please try again in a minute." },
      { status: 429 }
    );
  }

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

  const raw = await request.json().catch(() => null);
  const parsed = bookSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid request", details: parsed.error.format() },
      { status: 400 }
    );
  }
  const body = parsed.data;

  // reCAPTCHA runs for signal — the rate limiter above is the primary
  // anti-abuse gate on this endpoint. Blocking on a mis-registered site
  // key or a low v3 score would kill legit customer bookings. Soft-fail:
  // log and continue. Set RECAPTCHA_ENFORCE_PUBLIC=1 in the env when
  // you're confident the domain is registered and scoring is stable.
  const recaptcha = await verifyRecaptcha({
    token: body.recaptchaToken || "",
    ip: ipFromRequest(request),
    expectedAction: "book_appointment",
  });
  if (!recaptcha.ok) {
    // Phase I #4 (2026-09-11): HARD-FAIL — no bypass.
    console.warn(
      `[public appointment] reCAPTCHA rejected (${recaptcha.reason})`
    );
    return NextResponse.json(
      {
        success: false,
        error: "Verification failed. Please refresh the page and try again.",
      },
      { status: 403 }
    );
  }

  // Re-check availability at commit — the slot the customer picked may
  // have been taken between load and submit. This is the ONLY guard —
  // don't trust the client's "pick" on its own.
  const avail = await computeAvailability({
    tenantId: location.tenant.id,
    locationId: location.id,
    date: body.date,
    serviceProductIds: body.serviceIds,
    technicianId: body.technicianId,
  });
  const matchedSlot = avail.slots.find(
    (s) =>
      s.startTime === body.time &&
      (!body.technicianId || s.technicianId === body.technicianId)
  );
  if (!matchedSlot) {
    return NextResponse.json(
      {
        success: false,
        error:
          "That time is no longer available. Please pick a different slot.",
      },
      { status: 409 }
    );
  }
  const finalTechnicianId = body.technicianId || matchedSlot.technicianId;

  // Load the services fresh — never trust the client's prices. The
  // Order snapshots product name/price at write time so future edits to
  // the catalog don't rewrite history.
  const services = await prisma.product.findMany({
    where: {
      id: { in: body.serviceIds },
      tenantId: location.tenant.id,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      basePrice: true,
      prepTimeMinutes: true,
    },
  });
  if (services.length !== body.serviceIds.length) {
    return NextResponse.json(
      { success: false, error: "One or more services are no longer available." },
      { status: 400 }
    );
  }

  const subtotal = services.reduce((sum, s) => sum + s.basePrice, 0);

  // Build scheduledStart / scheduledEnd per line item so the availability
  // engine (which reads OrderItem.scheduledStart/End) picks up the block
  // on subsequent lookups.
  const dateStart = new Date(body.date + "T00:00:00Z");
  const [startH, startM] = body.time.split(":").map(Number);
  let cursor = dateStart.getTime() + (startH * 60 + startM) * 60_000;
  const itemsPayload = services.map((s) => {
    const dur = s.prepTimeMinutes ?? 30;
    const scheduledStart = new Date(cursor);
    const scheduledEnd = new Date(cursor + dur * 60_000);
    cursor = scheduledEnd.getTime();
    return {
      productId: s.id,
      productName: s.name,
      quantity: 1,
      unitPrice: s.basePrice,
      itemTotal: s.basePrice,
      technicianId: finalTechnicianId,
      scheduledStart,
      scheduledEnd,
    };
  });

  // Phase E R6: check deposit settings. If required, we create the
  // appointment in PENDING_PAYMENT status and hand the customer a
  // hosted deposit checkout URL. Once the deposit clears, the order
  // flips to NEW and shows up on the salon's board.
  const tenantRow = await prisma.tenant.findUnique({
    where: { id: location.tenant.id },
    select: {
      currency: true,
      settings: {
        select: {
          requireAppointmentDeposit: true,
          appointmentDepositType: true,
          appointmentDepositValue: true,
        },
      },
    },
  });
  const currency = tenantRow?.currency || "CAD";
  const depositSettings = depositSettingsFrom(tenantRow?.settings);
  const depositCents = computeDepositCents(subtotal, depositSettings);
  const depositRequired = depositCents > 0;

  const orderNumber = await nextAppointmentNumber(location.id, body.date);
  const displayNumber = await nextDisplayNumber(location.id);

  const order = await prisma.order.create({
    data: {
      locationId: location.id,
      orderNumber,
      displayNumber,
      orderType: "APPOINTMENT",
      // PENDING_PAYMENT keeps the appointment off the salon's board
      // until the deposit clears — no risk of a phantom slot when the
      // customer bails at the payment step.
      status: depositRequired ? "PENDING_PAYMENT" : "NEW",
      subtotal,
      total: subtotal,
      currency,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
      customerEmail: body.customerEmail || null,
      // Deposit amount + type get audit-logged in notes so the salon
      // can eyeball what was charged without a separate ledger table.
      notes: [
        body.notes,
        depositRequired
          ? `Deposit required: ${currency} ${(depositCents / 100).toFixed(2)} (pending)`
          : null,
      ]
        .filter(Boolean)
        .join(" · ") || null,
      appointmentDate: dateStart,
      appointmentTime: body.time,
      items: { create: itemsPayload },
    },
    select: {
      id: true,
      orderNumber: true,
      displayNumber: true,
      appointmentDate: true,
      appointmentTime: true,
    },
  });

  // Fire-and-forget SMS. Skip when a deposit is pending — the "you're
  // booked" text would be misleading. The confirmation SMS fires from
  // the mock-pay endpoint after the deposit clears.
  if (!depositRequired) {
    void (async () => {
      try {
        const totalMins = services.reduce(
          (sum, s) => sum + (s.prepTimeMinutes ?? 30),
          0
        );
        const svcNames = services.map((s) => s.name).join(", ");
        await sendSms({
          tenantId: location.tenant.id,
          to: body.customerPhone,
          body:
            `${location.tenant.name}: your appointment is confirmed for ` +
            `${body.date} at ${body.time} (${totalMins} min) — ${svcNames}. ` +
            `Ref: ${order.orderNumber}`,
          category: "appointment_confirm",
        });
      } catch (err) {
        console.warn("[public appointment] SMS confirmation failed:", err);
      }
    })();
  }

  return NextResponse.json({
    success: true,
    order: {
      id: order.id,
      orderNumber: order.orderNumber,
      displayNumber: order.displayNumber,
      appointmentDate: order.appointmentDate,
      appointmentTime: order.appointmentTime,
    },
    // Phase E R6: signals to the client that it must redirect the
    // customer to the deposit checkout instead of showing the "you're
    // booked" screen. paymentUrl is on the same origin so partner
    // domains stay branded.
    depositRequired,
    depositAmountCents: depositCents,
    currency,
    paymentUrl: depositRequired ? `/pay/appointment/${order.id}` : null,
  });
}
