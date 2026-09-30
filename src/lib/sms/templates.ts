// ============================================================================
// src/lib/sms/templates.ts
//
// Pre-built SMS message templates. Keep them SHORT — SMS is 160 chars per
// segment and carriers charge per segment. Each template targets <= 1 segment
// where possible (under 160 chars).
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
  partySize: number;
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

/** Reservation confirmation — sent on create. */
export function reservationConfirmationMessage(ctx: ReservationContext): string {
  // Short version: ~120 chars
  return `${ctx.restaurantName}: ${ctx.customerName}, your reservation for ${ctx.partySize} on ${formatDate(ctx.bookedFor)} is confirmed. See you then!`;
}

/** Reservation reminder — sent ~2-3 hours before. */
export function reservationReminderMessage(ctx: ReservationContext): string {
  return `${ctx.restaurantName}: Reminder — your reservation for ${ctx.partySize} is at ${ctx.bookedFor.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })} today. See you soon!`;
}

/** Reservation cancellation confirmation. */
export function reservationCancelledMessage(ctx: ReservationContext): string {
  return `${ctx.restaurantName}: Your reservation for ${formatDate(ctx.bookedFor)} has been cancelled. We hope to see you another time.`;
}

/** Waitlist "table almost ready" — invites 1/9 reply. */
export function waitlistNotifyMessage(ctx: WaitlistContext): string {
  return `${ctx.restaurantName}: ${ctx.customerName}, your table for ${ctx.partySize} is almost ready! Reply 1 to confirm you're still coming, or 9 to cancel. Thanks!`;
}

/** Waitlist confirmed (after guest replies 1). */
export function waitlistConfirmedMessage(ctx: WaitlistContext): string {
  return `${ctx.restaurantName}: Got it! Please come to the host stand — your table for ${ctx.partySize} is ready.`;
}

/** Waitlist removed (after guest replies 9 or times out). */
export function waitlistRemovedMessage(ctx: WaitlistContext): string {
  return `${ctx.restaurantName}: You've been removed from the waitlist. Sorry to miss you — come back any time!`;
}
