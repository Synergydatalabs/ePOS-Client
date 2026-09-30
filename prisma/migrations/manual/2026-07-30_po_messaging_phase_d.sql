-- ============================================================================
-- Purchase Order messaging — Phase D #74
-- Date: 2026-07-30
-- Database: itap_pos_dev (Aurora Postgres)
--
-- Adds:
--   1. Enum: PoMessageSide (MERCHANT / SUPPLIER)
--   2. purchase_order_messages table
--   3. Two indexes: chronological read + "unread count for the OTHER side"
--      (the second one powers the badge in the order list)
--
-- Read state is per-SIDE (not per-user) — a single readByOtherSideAt
-- timestamp per message tells us whether the opposite side has seen it.
-- Good enough for B2B where each side is effectively one voice; per-user
-- receipts can layer on later without changing existing queries.
--
-- Idempotent — every CREATE guarded.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Enum
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PoMessageSide') THEN
    CREATE TYPE "PoMessageSide" AS ENUM ('MERCHANT', 'SUPPLIER');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Messages table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchase_order_messages (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id      UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,

  sender_side            "PoMessageSide" NOT NULL,
  -- Nullable so a deleted membership doesn't wipe the message; senderName
  -- snapshot below preserves the attribution string.
  sender_membership_id   UUID REFERENCES memberships(id) ON DELETE SET NULL,
  sender_name            VARCHAR(150),

  body                   TEXT NOT NULL,

  -- Filled when the opposite side opens the thread. Null = unread.
  read_by_other_side_at  TIMESTAMPTZ,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Rejecting truly-empty messages at the DB level is cheap belt-and-braces.
  CONSTRAINT pom_body_not_empty CHECK (length(btrim(body)) > 0)
);

-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_pom_po_created
  ON purchase_order_messages(purchase_order_id, created_at);

-- Powers the "unread count for viewer" query:
--   WHERE purchase_order_id = ? AND sender_side = <other> AND read_by_other_side_at IS NULL
CREATE INDEX IF NOT EXISTS idx_pom_po_side_unread
  ON purchase_order_messages(purchase_order_id, sender_side, read_by_other_side_at);

COMMIT;
