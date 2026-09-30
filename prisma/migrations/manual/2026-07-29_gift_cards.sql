-- =====================================================================
-- Gift Cards Module
-- Date: 2026-07-29
-- Database: itap_pos_dev (Aurora Postgres, ca-central-1)
--
-- HOW TO APPLY:
--   1. psql to Aurora from EC2
--   2. \i this file (or paste contents)
--   3. Verify: \dt gift_cards, gift_card_transactions
--   4. On EC2: pull schema.prisma changes, run `npx prisma generate`
--
-- ROLLBACK: see bottom of file.
-- =====================================================================

BEGIN;

-- ── Enums ────────────────────────────────────────────────────────────
CREATE TYPE "GiftCardType" AS ENUM (
  'DIGITAL',    -- emailed / SMS'd code, no physical
  'PHYSICAL'    -- printed card with code, given at counter
);

CREATE TYPE "GiftCardStatus" AS ENUM (
  'ACTIVE',     -- issued, balance > 0
  'REDEEMED',   -- fully spent (balance = 0)
  'EXPIRED',    -- past expires_at
  'CANCELLED'   -- voided by admin
);

CREATE TYPE "GiftCardTxnType" AS ENUM (
  'ISSUE',      -- initial issuance credits initial_amount
  'REDEEM',     -- customer paid with the card
  'REFUND',     -- refund credited back to card
  'ADJUSTMENT', -- admin manual balance change
  'CANCEL'      -- balance zeroed by cancel
);

-- ── Table: gift_cards ────────────────────────────────────────────────
CREATE TABLE gift_cards (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Human-friendly code, e.g. "GC-XXXX-XXXX-XXXX" (16 base32 chars + prefix)
  code              VARCHAR(32) NOT NULL,

  type              "GiftCardType" NOT NULL DEFAULT 'DIGITAL',
  status            "GiftCardStatus" NOT NULL DEFAULT 'ACTIVE',

  -- Amounts in the tenant's default currency, stored in minor units (cents)
  initial_amount    INTEGER NOT NULL CHECK (initial_amount >= 0),
  balance           INTEGER NOT NULL CHECK (balance >= 0),
  currency          VARCHAR(3) NOT NULL DEFAULT 'CAD',

  -- Digital recipient details (nullable for physical)
  recipient_name    VARCHAR(255),
  recipient_email   VARCHAR(255),
  recipient_phone   VARCHAR(32),
  sender_name       VARCHAR(255),
  message           TEXT,

  -- Batch grouping so a set of physical cards printed together can be
  -- reprinted or filtered as one unit
  batch_id          UUID,

  issued_by_id      UUID REFERENCES memberships(id) ON DELETE SET NULL,
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  cancelled_reason  TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Uniqueness scoped to tenant so the same short code is theoretically
-- possible across tenants (in practice collision odds are astronomical).
CREATE UNIQUE INDEX idx_gift_cards_tenant_code ON gift_cards (tenant_id, code);
CREATE INDEX idx_gift_cards_tenant_status ON gift_cards (tenant_id, status);
CREATE INDEX idx_gift_cards_tenant_batch  ON gift_cards (tenant_id, batch_id)
  WHERE batch_id IS NOT NULL;
CREATE INDEX idx_gift_cards_recipient_email ON gift_cards (recipient_email)
  WHERE recipient_email IS NOT NULL;

-- ── Table: gift_card_transactions (append-only ledger) ───────────────
CREATE TABLE gift_card_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id      UUID NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  order_id          UUID REFERENCES orders(id) ON DELETE SET NULL,
  payment_id        UUID REFERENCES payments(id) ON DELETE SET NULL,

  type              "GiftCardTxnType" NOT NULL,
  -- signed cents: positive = credit to card, negative = debit
  amount            INTEGER NOT NULL,
  balance_after     INTEGER NOT NULL CHECK (balance_after >= 0),

  notes             TEXT,
  performed_by_id   UUID REFERENCES memberships(id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gc_txn_card ON gift_card_transactions (gift_card_id, created_at DESC);
CREATE INDEX idx_gc_txn_order ON gift_card_transactions (order_id)
  WHERE order_id IS NOT NULL;

COMMIT;

-- =====================================================================
-- ROLLBACK
-- =====================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS gift_card_transactions;
--   DROP TABLE IF EXISTS gift_cards;
--   DROP TYPE IF EXISTS "GiftCardTxnType";
--   DROP TYPE IF EXISTS "GiftCardStatus";
--   DROP TYPE IF EXISTS "GiftCardType";
-- COMMIT;
