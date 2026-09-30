// TAP POS Type Definitions

export type TenantStatus = "ACTIVE" | "SUSPENDED" | "CANCELLED";
export type LocationStatus = "ACTIVE" | "INACTIVE";
export type MemberRole = "TENANT_OWNER" | "POS_ADMIN" | "POS_MANAGER" | "POS_STAFF" | "KITCHEN_STAFF";
export type MemberStatus = "PENDING" | "ACTIVE" | "SUSPENDED";
export type SubscriptionStatus = "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
export type InvoiceStatus =
  | "OPEN"
  | "PENDING_PAYMENT"
  | "PAID"
  | "CANCELLED"
  | "REFUND_PENDING"
  | "PARTIALLY_REFUNDED"
  | "REFUNDED";
export type PaymentStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";
export type RefundStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  currency: string;
  timezone: string;
  logoUrl?: string;
  createdAt: Date;
}

export interface Location {
  id: string;
  tenantId: string;
  name: string;
  address?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country: string;
  phone?: string;
  status: LocationStatus;
  isDefault: boolean;
}

export interface Membership {
  id: string;
  tenantId: string;
  userSub: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: MemberRole;
  status: MemberStatus;
}

export interface Invoice {
  id: string;
  tenantId: string;
  locationId: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  subtotal: number;
  taxAmount: number;
  tipAmount: number;
  total: number;
  currency: string;
  orderReference?: string;
  customerEmail?: string;
  customerName?: string;
  paymentUrl?: string;
  paymentQrData?: string;
  paymentExpiresAt?: Date;
  paidAt?: Date;
  createdAt: Date;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  provider: string;
  providerRef?: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method?: string;
  createdAt: Date;
  completedAt?: Date;
}

export interface TenantSettings {
  id: string;
  tenantId: string;
  taxEnabled: boolean;
  taxRate: number;
  taxLabel: string;
  tipEnabled: boolean;
  tipPresets: number[];
  tipCustomEnabled: boolean;
  receiptHeader?: string;
  receiptFooter?: string;
  customerDisplayEnabled: boolean;
  showOrderDetails: boolean;
}

// API Request/Response types
export interface CreateTenantRequest {
  name: string;
  currency?: string;
  timezone?: string;
}

export interface CreateInvoiceRequest {
  locationId: string;
  items?: {
    name: string;
    description?: string;
    quantity: number;
    unitPrice: number;
  }[];
  subtotal?: number; // For amount-only invoices
  orderReference?: string;
  notes?: string;
}

export interface AddTipRequest {
  tipAmount: number; // in cents
}

export interface CreatePaymentSessionRequest {
  invoiceId: string;
}

export interface CreatePaymentSessionResponse {
  paymentUrl: string;
  qrPayload: string;
  expiresAt: Date;
}

export interface InviteMemberRequest {
  email: string;
  firstName?: string;
  lastName?: string;
  role: MemberRole;
}

// Offline sync types
export interface OfflineInvoice extends Omit<Invoice, "id"> {
  offlineId: string;
  synced: boolean;
}

export interface SyncStatus {
  pendingCount: number;
  lastSyncAt?: Date;
  isOnline: boolean;
}
