-- =============================================================================
-- Phase F #6t (2026-08-29) — vendor compliance fields for the pixel-perfect
-- per-vendor pay-page swap.
--
-- Adds three optional strings on supplier_products, all filled by the
-- vendor's brand handoff and shown verbatim in vendor mode:
--
--   vendor_legal_name           — parent company legal name (footer)
--                                 e.g. "RBP FINIVIS Private Limited"
--   vendor_license_text         — regulator + licence text (footer)
--                                 e.g. "RBI Licence No. CHG. FFMC 0297/2023"
--   vendor_statement_descriptor — how the charge appears on the buyer's card
--                                 statement, shown as a pre-payment notice
--                                 e.g. "MEGO PAY"
--
-- All optional; the pay page renders each block only when its field is set,
-- so a vendor without these still gets the theme swap without the extra
-- compliance text.
-- =============================================================================

BEGIN;

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS vendor_legal_name           VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS vendor_license_text         VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS vendor_statement_descriptor VARCHAR(64)  NULL;

COMMENT ON COLUMN supplier_products.vendor_legal_name IS
  'Vendor parent company legal name — e.g. "RBP FINIVIS Private Limited". Shown in the pay-page footer under vendor mode.';
COMMENT ON COLUMN supplier_products.vendor_license_text IS
  'Vendor regulator + licence text — e.g. "RBI Licence No. CHG. FFMC 0297/2023". Shown in the pay-page footer under vendor mode.';
COMMENT ON COLUMN supplier_products.vendor_statement_descriptor IS
  'How the charge appears on the buyer''s card statement — e.g. "MEGO PAY". Rendered as a pre-payment notice so buyers do not dispute a charge they do not recognize.';

-- Backfill MegoPay from the UI expert's handoff brand pack.
UPDATE supplier_products
SET vendor_legal_name           = 'RBP FINIVIS Private Limited',
    vendor_license_text         = 'RBI Licence No. CHG. FFMC 0297/2023',
    vendor_statement_descriptor = 'MEGO PAY'
WHERE supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND name = 'MegoPay Payment Gateway';

SELECT name,
       vendor_name,
       vendor_brand_color,
       vendor_legal_name,
       vendor_license_text,
       vendor_statement_descriptor
FROM supplier_products
WHERE supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND name = 'MegoPay Payment Gateway';

COMMIT;
