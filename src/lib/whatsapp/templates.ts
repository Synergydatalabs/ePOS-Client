// ============================================================================
// src/lib/whatsapp/templates.ts
//
// WhatsApp template names + parameter shapes. These templates must be
// pre-approved in Meta Business Manager BEFORE they can be sent.
//
// To register a template:
//   Meta Business → WhatsApp Business → Message Templates → Create
//   - Category: UTILITY (for confirmations, reminders — cheaper than MARKETING)
//   - Language: en_US (plus any others your customers speak)
//   - Body text with {{1}}, {{2}} placeholders matching the parameters here
//
// Naming convention: use snake_case, prefix with "oreugo_" for clarity.
// If a template isn't approved yet, the client falls back to free-form text
// (which only works if guest has messaged you in the last 24h — caller decides).
// ============================================================================

export const WHATSAPP_TEMPLATES = {
  /**
   * Phase I #4 (2026-09-12): AUTHENTICATION category template for OTP
   * verification codes. Meta requires this category for verification
   * codes — free-form text only reaches recipients who messaged the
   * WABA in the last 24h, which brand-new signups never have.
   *
   * Register in Meta Business Manager:
   *   Name:     oreugo_signup_otp
   *   Category: AUTHENTICATION
   *   Language: en (or en_US)
   *   Body:     "{{1}} is your verification code. For your security, do not share this code."
   *   Button:   Copy code — Type: One-tap, Autofill text: "Copy code",
   *             Package name / signature not required for cross-device.
   *
   * Override the template name via env WHATSAPP_OTP_TEMPLATE if you
   * register it under a different name (e.g. per-partner deployment).
   * Parameters: [otpCode]
   */
  SIGNUP_OTP: {
    name: process.env.WHATSAPP_OTP_TEMPLATE || "oreugo_signup_otp",
    languageCode: process.env.WHATSAPP_OTP_LANGUAGE || "en",
    paramCount: 1,
  },

  /**
   * Body example:
   *   "Hi {{1}}, your reservation at {{2}} for {{3}} on {{4}} is confirmed. See you then!"
   *   Parameters: [customerName, restaurantName, partySize, dateTimeStr]
   */
  RESERVATION_CONFIRMATION: {
    name: "reservation_confirmation",
    paramCount: 4,
  },

  /**
   * Body:
   *   "Reminder: your reservation at {{1}} is at {{2}} today. Reply if you need to change anything."
   *   Parameters: [restaurantName, timeStr]
   */
  RESERVATION_REMINDER: {
    name: "reservation_reminder",
    paramCount: 2,
  },

  /**
   * Body:
   *   "{{1}}, your table at {{2}} is almost ready. Reply 1 to confirm you're coming, or 9 to cancel."
   *   Parameters: [customerName, restaurantName]
   */
  WAITLIST_NOTIFY: {
    name: "waitlist_notify",
    paramCount: 2,
  },

  /**
   * Body:
   *   "{{1}}, your reservation at {{2}} on {{3}} has been cancelled. We hope to see you again soon."
   *   Parameters: [customerName, restaurantName, dateTimeStr]
   */
  RESERVATION_CANCELLED: {
    name: "reservation_cancelled",
    paramCount: 3,
  },
} as const;

// ============================================================================
// Helper builders — formatters that take domain objects and produce the
// parameter arrays for sendWhatsApp.
// ============================================================================

interface ReservationContext {
  restaurantName: string;
  customerName: string;
  partySize: number;
  bookedFor: Date;
}

interface WaitlistContext {
  restaurantName: string;
  customerName: string;
}

function formatDate(d: Date): string {
  return d.toLocaleString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function reservationConfirmationTemplate(ctx: ReservationContext) {
  return {
    name: WHATSAPP_TEMPLATES.RESERVATION_CONFIRMATION.name,
    parameters: [
      ctx.customerName,
      ctx.restaurantName,
      String(ctx.partySize),
      formatDate(ctx.bookedFor),
    ],
  };
}

export function reservationReminderTemplate(ctx: ReservationContext) {
  return {
    name: WHATSAPP_TEMPLATES.RESERVATION_REMINDER.name,
    parameters: [
      ctx.restaurantName,
      ctx.bookedFor.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" }),
    ],
  };
}

export function waitlistNotifyTemplate(ctx: WaitlistContext) {
  return {
    name: WHATSAPP_TEMPLATES.WAITLIST_NOTIFY.name,
    parameters: [ctx.customerName, ctx.restaurantName],
  };
}

export function reservationCancelledTemplate(ctx: ReservationContext) {
  return {
    name: WHATSAPP_TEMPLATES.RESERVATION_CANCELLED.name,
    parameters: [ctx.customerName, ctx.restaurantName, formatDate(ctx.bookedFor)],
  };
}

// ============================================================================
// Free-form text fallback templates — used in 24h window after inbound message
// ============================================================================

export function reservationConfirmationText(ctx: ReservationContext): string {
  return `Hi ${ctx.customerName}, your reservation at ${ctx.restaurantName} for ${ctx.partySize} on ${formatDate(ctx.bookedFor)} is confirmed. See you then!`;
}

export function waitlistNotifyText(ctx: WaitlistContext): string {
  return `${ctx.restaurantName}: ${ctx.customerName}, your table is almost ready! Reply 1 to confirm you're coming, or 9 to cancel.`;
}

export function reservationReminderText(ctx: ReservationContext): string {
  return `${ctx.restaurantName}: Reminder — your reservation for ${ctx.partySize} is ${formatDate(ctx.bookedFor)}. See you soon! Reply 9 to cancel if you can't make it.`;
}

export function waitlistConfirmedReplyText(ctx: WaitlistContext): string {
  return `${ctx.restaurantName}: Great! Please come to the host stand — your table is ready.`;
}

export function waitlistRemovedReplyText(ctx: WaitlistContext): string {
  return `${ctx.restaurantName}: You've been removed from the waitlist. Come back any time!`;
}
