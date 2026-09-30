-- iTAP POS Database Setup
-- Database: tap_db
-- Run this script on your AWS Aurora PostgreSQL cluster

-- ============================================
-- 1. CREATE DATABASE (run as superuser)
-- ============================================
-- CREATE DATABASE tap_db;

-- ============================================
-- 2. ENABLE REQUIRED EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- 3. CREATE ENUM TYPES
-- ============================================

-- Tenant Status
DO $$ BEGIN
    CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Location Status
DO $$ BEGIN
    CREATE TYPE "LocationStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Member Role
DO $$ BEGIN
    CREATE TYPE "MemberRole" AS ENUM ('TENANT_OWNER', 'POS_ADMIN', 'POS_MANAGER', 'POS_STAFF');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Member Status
DO $$ BEGIN
    CREATE TYPE "MemberStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Subscription Status
DO $$ BEGIN
    CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Billing Invoice Status
DO $$ BEGIN
    CREATE TYPE "BillingInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Invoice Status
DO $$ BEGIN
    CREATE TYPE "InvoiceStatus" AS ENUM ('OPEN', 'PENDING_PAYMENT', 'PAID', 'CANCELLED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Payment Status
DO $$ BEGIN
    CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Refund Status
DO $$ BEGIN
    CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================
-- 4. CREATE TABLES
-- ============================================

-- Tenants (Business accounts)
CREATE TABLE IF NOT EXISTS "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CAD',
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'America/Toronto',
    "logo_url" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_key" ON "tenants"("slug");

-- Locations
CREATE TABLE IF NOT EXISTS "locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "address" VARCHAR(500),
    "city" VARCHAR(100),
    "province" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "country" VARCHAR(2) NOT NULL DEFAULT 'CA',
    "phone" VARCHAR(20),
    "status" "LocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "locations_tenant_id_idx" ON "locations"("tenant_id");

-- Memberships (Staff)
CREATE TABLE IF NOT EXISTS "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_sub" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "role" "MemberRole" NOT NULL DEFAULT 'POS_STAFF',
    "status" "MemberStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by" UUID,
    "invited_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "memberships_tenant_id_user_sub_key" ON "memberships"("tenant_id", "user_sub");
CREATE UNIQUE INDEX IF NOT EXISTS "memberships_tenant_id_email_key" ON "memberships"("tenant_id", "email");
CREATE INDEX IF NOT EXISTS "memberships_user_sub_idx" ON "memberships"("user_sub");
CREATE INDEX IF NOT EXISTS "memberships_email_idx" ON "memberships"("email");

-- Subscriptions
CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "plan" VARCHAR(50) NOT NULL DEFAULT 'standard',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "monthly_price" INTEGER NOT NULL DEFAULT 0,
    "trial_ends_at" TIMESTAMP(3),
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "subscriptions_tenant_id_idx" ON "subscriptions"("tenant_id");
CREATE INDEX IF NOT EXISTS "subscriptions_status_idx" ON "subscriptions"("status");

-- Billing Invoices (B2B monthly invoices)
CREATE TABLE IF NOT EXISTS "billing_invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CAD',
    "status" "BillingInvoiceStatus" NOT NULL DEFAULT 'SENT',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "due_date" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "payment_ref" VARCHAR(255),
    "payment_qr_url" VARCHAR(500),
    "reminders_sent" INTEGER NOT NULL DEFAULT 0,
    "last_reminder_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_invoices_invoice_number_key" ON "billing_invoices"("invoice_number");
CREATE INDEX IF NOT EXISTS "billing_invoices_tenant_id_idx" ON "billing_invoices"("tenant_id");
CREATE INDEX IF NOT EXISTS "billing_invoices_status_idx" ON "billing_invoices"("status");
CREATE INDEX IF NOT EXISTS "billing_invoices_due_date_idx" ON "billing_invoices"("due_date");

-- Tenant Settings
CREATE TABLE IF NOT EXISTS "tenant_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "tax_enabled" BOOLEAN NOT NULL DEFAULT true,
    "tax_rate" DECIMAL(5,2) NOT NULL DEFAULT 13.00,
    "tax_label" VARCHAR(20) NOT NULL DEFAULT 'HST',
    "tip_enabled" BOOLEAN NOT NULL DEFAULT true,
    "tip_presets" JSONB NOT NULL DEFAULT '[15, 18, 20]',
    "tip_custom_enabled" BOOLEAN NOT NULL DEFAULT true,
    "receipt_header" TEXT,
    "receipt_footer" TEXT,
    "receipt_logo_url" VARCHAR(500),
    "customer_display_enabled" BOOLEAN NOT NULL DEFAULT true,
    "show_order_details" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_settings_tenant_id_key" ON "tenant_settings"("tenant_id");

-- Invoices (POS sales)
CREATE TABLE IF NOT EXISTS "invoices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "created_by_id" UUID,
    "invoice_number" VARCHAR(50) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "subtotal" INTEGER NOT NULL DEFAULT 0,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "tip_amount" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CAD',
    "order_reference" VARCHAR(100),
    "notes" TEXT,
    "customer_email" VARCHAR(255),
    "customer_name" VARCHAR(255),
    "payment_url" VARCHAR(500),
    "payment_qr_data" TEXT,
    "payment_expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "offline_id" VARCHAR(100),
    "synced_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenant_id_invoice_number_key" ON "invoices"("tenant_id", "invoice_number");
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_offline_id_key" ON "invoices"("offline_id");
CREATE INDEX IF NOT EXISTS "invoices_tenant_id_status_idx" ON "invoices"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "invoices_location_id_idx" ON "invoices"("location_id");
CREATE INDEX IF NOT EXISTS "invoices_created_at_idx" ON "invoices"("created_at");

-- Invoice Items
CREATE TABLE IF NOT EXISTS "invoice_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "invoice_items_invoice_id_idx" ON "invoice_items"("invoice_id");

-- Payments
CREATE TABLE IF NOT EXISTS "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invoice_id" UUID NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "provider_ref" VARCHAR(255),
    "provider_status" VARCHAR(50),
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CAD',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" VARCHAR(50),
    "metadata" JSONB,
    "failure_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payments_invoice_id_idx" ON "payments"("invoice_id");
CREATE INDEX IF NOT EXISTS "payments_provider_ref_idx" ON "payments"("provider_ref");
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments"("status");

-- Refunds
CREATE TABLE IF NOT EXISTS "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" VARCHAR(255),
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "provider_ref" VARCHAR(255),
    "initiated_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "refunds_payment_id_idx" ON "refunds"("payment_id");

-- Webhook Logs
CREATE TABLE IF NOT EXISTS "webhook_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" VARCHAR(50) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'received',
    "error" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "webhook_logs_provider_event_type_idx" ON "webhook_logs"("provider", "event_type");
CREATE INDEX IF NOT EXISTS "webhook_logs_created_at_idx" ON "webhook_logs"("created_at");

-- Sync Queue (for offline mode)
CREATE TABLE IF NOT EXISTS "sync_queue" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" VARCHAR(100) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "retries" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "sync_queue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "sync_queue_tenant_id_status_idx" ON "sync_queue"("tenant_id", "status");
CREATE INDEX IF NOT EXISTS "sync_queue_created_at_idx" ON "sync_queue"("created_at");

-- ============================================
-- 5. ADD FOREIGN KEY CONSTRAINTS
-- ============================================

-- Locations -> Tenants
ALTER TABLE "locations"
    DROP CONSTRAINT IF EXISTS "locations_tenant_id_fkey",
    ADD CONSTRAINT "locations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Memberships -> Tenants
ALTER TABLE "memberships"
    DROP CONSTRAINT IF EXISTS "memberships_tenant_id_fkey",
    ADD CONSTRAINT "memberships_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Subscriptions -> Tenants
ALTER TABLE "subscriptions"
    DROP CONSTRAINT IF EXISTS "subscriptions_tenant_id_fkey",
    ADD CONSTRAINT "subscriptions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Billing Invoices -> Tenants
ALTER TABLE "billing_invoices"
    DROP CONSTRAINT IF EXISTS "billing_invoices_tenant_id_fkey",
    ADD CONSTRAINT "billing_invoices_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant Settings -> Tenants
ALTER TABLE "tenant_settings"
    DROP CONSTRAINT IF EXISTS "tenant_settings_tenant_id_fkey",
    ADD CONSTRAINT "tenant_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invoices -> Tenants
ALTER TABLE "invoices"
    DROP CONSTRAINT IF EXISTS "invoices_tenant_id_fkey",
    ADD CONSTRAINT "invoices_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invoices -> Locations
ALTER TABLE "invoices"
    DROP CONSTRAINT IF EXISTS "invoices_location_id_fkey",
    ADD CONSTRAINT "invoices_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON UPDATE CASCADE;

-- Invoices -> Memberships (created by)
ALTER TABLE "invoices"
    DROP CONSTRAINT IF EXISTS "invoices_created_by_id_fkey",
    ADD CONSTRAINT "invoices_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "memberships"("id") ON UPDATE CASCADE;

-- Invoice Items -> Invoices
ALTER TABLE "invoice_items"
    DROP CONSTRAINT IF EXISTS "invoice_items_invoice_id_fkey",
    ADD CONSTRAINT "invoice_items_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payments -> Invoices
ALTER TABLE "payments"
    DROP CONSTRAINT IF EXISTS "payments_invoice_id_fkey",
    ADD CONSTRAINT "payments_invoice_id_fkey"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Refunds -> Payments
ALTER TABLE "refunds"
    DROP CONSTRAINT IF EXISTS "refunds_payment_id_fkey",
    ADD CONSTRAINT "refunds_payment_id_fkey"
    FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- 6. CREATE UPDATE TRIGGER FOR updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to all tables with updated_at column
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT table_name FROM information_schema.columns
             WHERE column_name = 'updated_at'
             AND table_schema = 'public'
             AND table_name IN ('tenants', 'locations', 'memberships', 'subscriptions',
                               'billing_invoices', 'tenant_settings', 'invoices', 'payments')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%I_updated_at ON %I', t, t);
        EXECUTE format('CREATE TRIGGER update_%I_updated_at
                        BEFORE UPDATE ON %I
                        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
    END LOOP;
END $$;

-- ============================================
-- DONE! Database is ready for iTAP POS
-- ============================================

-- To verify, run:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
