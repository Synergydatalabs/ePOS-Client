// Shared client-side types for the onboarding wizard.
// Kept in one file so every step imports from the same shape and a change
// in the API response propagates through the compiler.

export type ApplicationStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "FORWARDED"
  | "INFO_REQUESTED"
  | "PROVIDER_APPROVED"
  | "APPROVED"
  | "REJECTED"
  | "LIVE";

export interface BusinessAddress {
  line1?: string;
  line2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string; // ISO-3
}

export interface FinancialsExtras {
  expectedCurrencies?: string[];  // ISO-4217 codes
  channels?: string[];            // "IN_PERSON" | "ONLINE" | "MAIL_ORDER" | "RECURRING"
  highRisk?: boolean;
  highRiskDetails?: string;
}

// Wizard-side application shape (subset of the DB row). Never contains
// decrypted PII — the server only returns "hasTaxId" / "hasBankInfo"
// booleans for hydration.
export interface WizardApplication {
  id: string;
  status: ApplicationStatus;
  tenantRole: "MERCHANT" | "SUPPLIER";
  targetProcessor: "GP" | "MONERIS" | "STRIPE" | null;

  legalName: string;
  dbaName: string | null;
  businessTypeName: string | null;
  incorporationDate: string | null;
  incorporationRegion: string | null;
  businessAddress: (BusinessAddress & FinancialsExtras) | null;
  websiteUrl: string | null;
  mccCode: string | null;

  projectedMonthlyVolumeCents: number | null;
  averageTicketCents: number | null;
  currency: string;

  hasTaxId: boolean;
  hasBankInfo: boolean;

  signerName: string | null;
  signerTitle: string | null;
  signerEmail: string | null;
  signerConsentedAt: string | null;

  infoRequested: string | null;
  rejectionReason: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;

  ubos: WizardUbo[];
  documents: WizardDocument[];
}

export interface WizardUbo {
  id: string;
  fullName: string;
  dateOfBirth: string | null;
  nationality: string;
  residentialAddress: Record<string, string> | null;
  ownershipPct: number;
  isDirector: boolean;
  isSignatory: boolean;
  idType: "PASSPORT" | "DRIVERS_LICENSE" | "NATIONAL_ID";
  hasIdNumber: boolean;
  idExpiry: string | null;
  idIssuingCountry: string | null;
  sourceOfFunds: string | null;
  isPep: boolean;
}

export interface WizardDocument {
  id: string;
  docType: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: string;
  createdAt: string;
}
