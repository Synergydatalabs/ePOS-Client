// Appointment deposit calculator — Phase E R6.
//
// Server-authoritative. Client can show a preview but the write path
// always re-computes so a tampered client can't pay less than required.

export type DepositType = "PERCENT" | "FIXED";

export interface DepositSettings {
  required: boolean;
  type: DepositType;
  value: number;
}

/**
 * Compute the deposit amount in cents. Clamps to [0, subtotal] so we
 * never charge more than the whole booking.
 */
export function computeDepositCents(
  subtotalCents: number,
  settings: DepositSettings
): number {
  if (!settings.required) return 0;
  if (subtotalCents <= 0) return 0;
  let deposit: number;
  if (settings.type === "PERCENT") {
    const pct = Math.max(0, Math.min(100, Number(settings.value) || 0));
    deposit = Math.round((subtotalCents * pct) / 100);
  } else {
    deposit = Math.max(0, Math.floor(Number(settings.value) || 0));
  }
  return Math.min(deposit, subtotalCents);
}

/**
 * Convenience: pull the deposit settings out of a
 * `prisma.tenantSettings` row. Defensive — falls back to sane defaults
 * when the row is null.
 */
export function depositSettingsFrom(
  row:
    | {
        requireAppointmentDeposit: boolean;
        appointmentDepositType: string;
        appointmentDepositValue: number;
      }
    | null
    | undefined
): DepositSettings {
  return {
    required: !!row?.requireAppointmentDeposit,
    type: row?.appointmentDepositType === "FIXED" ? "FIXED" : "PERCENT",
    value: row?.appointmentDepositValue ?? 25,
  };
}
