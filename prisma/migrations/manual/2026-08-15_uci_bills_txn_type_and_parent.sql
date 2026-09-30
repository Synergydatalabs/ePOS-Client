-- Moneris 1b — support linked refund/void rows in uci_bills.
--
-- Adds:
--   • parent_bill_id — points at the original PAID row when this row is a
--     REFUND or VOID. NULL for charges. Enables "list all refunds for this
--     bill" without hunting through JSON payloads.
--   • txn_type — CHARGE (default, existing rows), REFUND, VOID. Filters
--     the history view by the operation kind.
--
-- Idempotent. Safe to re-run.

ALTER TABLE uci_bills
  ADD COLUMN IF NOT EXISTS parent_bill_id UUID
    REFERENCES uci_bills(id) ON DELETE SET NULL;

ALTER TABLE uci_bills
  ADD COLUMN IF NOT EXISTS txn_type VARCHAR(20) NOT NULL DEFAULT 'CHARGE';

-- Partial index — only rows that ARE refunds/voids have a parent,
-- keeping the index small (which the majority-charge use case wants).
CREATE INDEX IF NOT EXISTS idx_uci_bills_parent
  ON uci_bills (parent_bill_id)
  WHERE parent_bill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_uci_bills_txn_type
  ON uci_bills (txn_type)
  WHERE txn_type != 'CHARGE';
