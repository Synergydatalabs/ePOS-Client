-- 2026-10-09 — Add HELCIM to PaymentProcessor enum.
--
-- Prisma can't express ALTER TYPE ... ADD VALUE in migrate, so this
-- lives as a plain SQL file to run manually against the DB.
-- Idempotent: skips when the value already exists.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'PaymentProcessor' AND e.enumlabel = 'HELCIM'
  ) THEN
    ALTER TYPE "PaymentProcessor" ADD VALUE 'HELCIM';
  END IF;
END$$;
