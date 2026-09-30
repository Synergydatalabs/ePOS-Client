-- Phase I #3 (2026-09-10) — per-link partner notification emails.
--
-- Adds an optional free-text column to supplier_payment_links: a comma-
-- separated list of email addresses that receive a "payment received"
-- notification each time a payment through this link succeeds. Empty /
-- NULL = only the customer gets a receipt; supplier's ops-channel
-- Telegram is unaffected.
--
-- Length matches the redirect_url column (1000 chars) — well past what
-- half a dozen "sales@acme.com" entries would ever need, and small enough
-- that a copy-paste of an address book gets caught client-side.

ALTER TABLE supplier_payment_links
  ADD COLUMN IF NOT EXISTS notify_emails VARCHAR(1000);
