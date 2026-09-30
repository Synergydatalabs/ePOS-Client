-- =============================================================================
-- Phase G #1 (2026-08-30) — MegoPay T&C v2 (subscription addendum).
--
-- New SupplierTermsVersion for the "MegoPay Payment Gateway" product,
-- extending the existing megopay-2026-08-29.1 with subscription-aware
-- clauses: auto-renewal disclosure, cancellation policy, price-change
-- notice, dunning cadence. Existing paid invoices keep pointing at the
-- old version (immutable audit); new pay-page loads pick up v2 via
-- the product's terms_version_id FK.
--
-- Version bump: megopay-2026-08-30.1
-- =============================================================================

BEGIN;

WITH inserted_terms AS (
  INSERT INTO supplier_terms_versions (
    supplier_tenant_id,
    version,
    body_markdown,
    effective_from,
    effective_to,
    created_at
  )
  VALUES (
    (SELECT id FROM tenants WHERE slug = 'synergy-data-labs'),
    'megopay-2026-08-30.1',
    E'# MegoPay Buyer Terms and Conditions\n\n**Version:** 2026-08-30.1 (subscription addendum)\n**Vendor:** MegoPay (a brand of RBP FINIVIS Private Limited)\n**Reseller / Merchant of Record:** Synergy Data Labs\n**Payment identifier:** Charges appear on your statement as MEGO PAY\n**RBI Licence No.:** CHG. FFMC 0297/2023\n\n---\n\n## 1. Scope\n\nThese Terms govern your purchase of the MegoPay Payment Gateway software licence and any related services. Two purchase types are supported:\n\n- **One-time licence** — you pay once for a perpetual right to use the current version.\n- **Subscription (monthly or annual)** — you pay a recurring fee for continued access, updates, and support during each billing period.\n\nThe purchase type is selected on your invoice. Sections 8–12 (subscription-specific terms) apply only when your invoice is a subscription invoice.\n\n## 2. Parties\n\nThe software vendor is **RBP FINIVIS Private Limited** ("MegoPay"), operating as an RBI-Licensed Full-Fledged Money Changer under Licence No. CHG. FFMC 0297/2023. Your invoice is issued and payment is processed by **Synergy Data Labs** as reseller / merchant of record.\n\n## 3. Grant of licence\n\nSubject to your payment of applicable fees, MegoPay grants you a non-exclusive, non-transferable licence to install and use the MegoPay Payment Gateway software solely for your own business operations, on the terms of the Licence Agreement in force at the time of purchase.\n\n## 4. Delivery\n\nSoftware is delivered digitally. Delivery is complete when you receive access credentials or the download link. **You acknowledge that once delivery has begun, your 14-day right of withdrawal / cancellation is lost.**\n\n## 5. Payment\n\nAll amounts are due in the currency shown on your invoice. Payments are processed via Synergy Data Labs''s payment provider. You authorise the charge shown on your invoice at the moment you click Pay.\n\n## 6. Refunds\n\nDigital licence purchases are non-refundable once delivered. If you believe delivery failed or the software does not function as described, contact **support@rbpfinivis.com** within 7 days of purchase. Refunds, when granted, are processed to the original payment method within 5–10 business days.\n\n## 7. Statement descriptor\n\nYour card statement will show the charge as **MEGO PAY**. Please note this identifier — it will not carry the reseller''s or your own business name.\n\n---\n\n## 8. Subscription auto-renewal *(subscription invoices only)*\n\nIf your invoice is a subscription invoice, you agree that a new invoice will be automatically generated at the end of each billing period (monthly or annual, as shown on your invoice) and emailed to you at the address on file. Each recurring invoice contains a fresh secure payment link — you must click Pay to continue. **We do not save your card.** Missing a payment does not automatically renew your access.\n\n## 9. Cancellation *(subscription invoices only)*\n\nYou may cancel your subscription at any time using the "Cancel subscription" link in any invoice email, or by contacting **support@rbpfinivis.com**. Cancellation:\n\n- takes effect immediately for future billing (no more invoices will be generated);\n- does not entitle you to a refund for the current period unless the Refund Policy in §6 applies;\n- does not affect any invoice already issued — you may pay or ignore it at your discretion.\n\n## 10. Payment reminders and non-payment *(subscription invoices only)*\n\nIf a subscription invoice remains unpaid we will send reminders at approximately 3 days and 7 days after the invoice date. If payment is not received within **14 days**, we will send a final notice and automatically cancel your subscription. You may reactivate at any time by starting a new subscription — pricing at that time may differ.\n\n## 11. Price changes *(subscription invoices only)*\n\nWe may change the subscription price. If we do, we will notify you at the email on file at least **30 days** before the new price takes effect on your next invoice. You may cancel under §9 before the new price applies. Continued payment after the notice period constitutes acceptance of the new price.\n\n## 12. Currency and taxes\n\nSubscription pricing is in the currency shown on your invoice. Applicable taxes are added at invoice time; the tax amount is shown separately on the invoice.\n\n---\n\n## 13. Acceptable use\n\nYou will use the software only for lawful business purposes and in compliance with all applicable financial-services regulations in your jurisdiction. You will not sublicense, resell, reverse-engineer, or attempt to circumvent authentication mechanisms.\n\n## 14. Support\n\nProduct support is provided by MegoPay at **support@rbpfinivis.com**. Billing questions may be directed to Synergy Data Labs at **info@synergydatalabs.com**.\n\n## 15. Data protection\n\nMegoPay and Synergy Data Labs each process personal data in accordance with their published Privacy Notices. By purchasing, you consent to the processing described in those notices.\n\n## 16. Warranty and limitation of liability\n\nThe software is provided "as is". To the maximum extent permitted by law, neither MegoPay nor Synergy Data Labs will be liable for any indirect, incidental, or consequential damages arising from your use of the software. Total liability for any claim is limited to the fees paid by you in the twelve months preceding the claim.\n\n## 17. Governing law\n\nDisputes arising from your purchase are governed by the laws of the jurisdiction of Synergy Data Labs''s place of business (Ontario, Canada), without regard to conflict-of-law rules. Disputes arising from the MegoPay software itself are governed by the laws of India (jurisdiction: Panchkula, Haryana) as set out in the MegoPay Licence Agreement.\n\n## 18. Contacts\n\n- MegoPay (vendor): support@rbpfinivis.com\n- Synergy Data Labs (billing / reseller): info@synergydatalabs.com\n- MegoPay parent: RBP FINIVIS Private Limited · CIN U65990HR2019PTC081650\n- Registered office: Office No. 18, 3rd Floor, Agro Mall, Sector 20, Panchkula, Haryana 134117\n\n---\n\n_By clicking "Pay" on your invoice, you accept these Terms and, where your invoice is a subscription invoice, you accept the recurring-billing terms in §§8–12._',
    NOW(),
    NULL,
    NOW()
  )
  RETURNING id
),
retired_old AS (
  -- Mark the previous version as ended so any brand-new query for the
  -- "active" terms picks v2. The old row itself stays queryable by id
  -- for legacy invoices — this only changes `effective_to`.
  UPDATE supplier_terms_versions
  SET effective_to = NOW()
  WHERE version = 'megopay-2026-08-29.1'
    AND effective_to IS NULL
  RETURNING id
)
-- Point the MegoPay product at the new T&C row.
UPDATE supplier_products
SET terms_version_id = (SELECT id FROM inserted_terms)
WHERE supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND name = 'MegoPay Payment Gateway';

-- Sanity check
SELECT
  p.name,
  tv.version AS new_terms_version,
  tv.effective_from
FROM supplier_products p
JOIN supplier_terms_versions tv ON tv.id = p.terms_version_id
WHERE p.supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND p.name = 'MegoPay Payment Gateway';

COMMIT;
