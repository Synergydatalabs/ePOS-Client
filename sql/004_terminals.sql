-- ============================================
-- Global Payments UPA Terminal Integration
-- Run this on the itap_pos_dev database
-- ============================================

-- Terminal status enum
DO $$ BEGIN
  CREATE TYPE "TerminalStatus" AS ENUM ('ONLINE', 'OFFLINE', 'BUSY', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Terminal transaction status enum
DO $$ BEGIN
  CREATE TYPE "TerminalTxStatus" AS ENUM ('SENT', 'SUCCESS', 'FAILED', 'CANCELLED', 'TIMEOUT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Terminals table
CREATE TABLE IF NOT EXISTS "terminals" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "location_id" UUID NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "ip_address" VARCHAR(45) NOT NULL,
  "port" INTEGER NOT NULL DEFAULT 8081,
  "serial_number" VARCHAR(100),
  "model" VARCHAR(100),
  "status" "TerminalStatus" NOT NULL DEFAULT 'OFFLINE',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "last_ping_at" TIMESTAMP(3),
  "last_eod_at" TIMESTAMP(3),
  "ecr_id" VARCHAR(10) NOT NULL DEFAULT '13',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "terminals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "terminals_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "terminals_location_id_ip_address_port_key" ON "terminals"("location_id", "ip_address", "port");
CREATE INDEX IF NOT EXISTS "terminals_location_id_idx" ON "terminals"("location_id");

-- Terminal transactions (audit log)
CREATE TABLE IF NOT EXISTS "terminal_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "terminal_id" UUID NOT NULL,
  "order_id" UUID,
  "payment_id" UUID,

  "command" VARCHAR(50) NOT NULL,
  "transaction_type" VARCHAR(20),
  "request_id" VARCHAR(50) NOT NULL,
  "request_payload" JSONB NOT NULL,
  "response_payload" JSONB,

  "amount" INTEGER,
  "tip_amount" INTEGER,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'CAD',

  "result" VARCHAR(20),
  "error_code" VARCHAR(20),
  "error_message" TEXT,

  "reference_number" VARCHAR(50),
  "gp_transaction_id" VARCHAR(50),
  "auth_code" VARCHAR(20),
  "card_type" VARCHAR(20),
  "masked_pan" VARCHAR(20),
  "entry_mode" VARCHAR(20),

  "status" "TerminalTxStatus" NOT NULL DEFAULT 'SENT',
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "responded_at" TIMESTAMP(3),

  CONSTRAINT "terminal_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "terminal_transactions_terminal_id_fkey" FOREIGN KEY ("terminal_id") REFERENCES "terminals"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "terminal_transactions_terminal_id_idx" ON "terminal_transactions"("terminal_id");
CREATE INDEX IF NOT EXISTS "terminal_transactions_order_id_idx" ON "terminal_transactions"("order_id");
CREATE INDEX IF NOT EXISTS "terminal_transactions_reference_number_idx" ON "terminal_transactions"("reference_number");
CREATE INDEX IF NOT EXISTS "terminal_transactions_request_id_idx" ON "terminal_transactions"("request_id");

-- Add terminal settings columns to tenant_settings
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "payment_terminal_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "quick_chip_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenant_settings" ADD COLUMN IF NOT EXISTS "line_item_display_enabled" BOOLEAN NOT NULL DEFAULT true;
