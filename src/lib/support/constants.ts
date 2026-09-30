// Mirror of tapapp-admin/src/lib/support/constants.ts — same enum values,
// so both apps agree on the wire format. Hardcoded to work around Next 15's
// build-time page-data collector choking on module-scope Prisma enum spreads.

export const SUPPORT_THREAD_STATUSES = [
  "OPEN",
  "WAITING_MERCHANT",
  "WAITING_SUPPLIER",
  "WAITING_ADMIN",
  "RESOLVED",
  "CLOSED",
] as const;
export type SupportThreadStatusValue = (typeof SUPPORT_THREAD_STATUSES)[number];

export const SUPPORT_PARTY_TYPES = ["ADMIN", "MERCHANT", "SUPPLIER", "SYSTEM"] as const;
export type SupportPartyTypeValue = (typeof SUPPORT_PARTY_TYPES)[number];

export const SUPPORT_ENTITY_TYPES = [
  "MERCHANT_APPLICATION",
  "PURCHASE_ORDER",
  "TRANSACTION",
] as const;
export type SupportEntityTypeValue = (typeof SUPPORT_ENTITY_TYPES)[number];

export const SUPPORT_STATUS_LABELS: Record<SupportThreadStatusValue, string> = {
  OPEN: "Open",
  WAITING_MERCHANT: "Waiting on you",
  WAITING_SUPPLIER: "Waiting on you",
  WAITING_ADMIN: "Waiting on support",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};
