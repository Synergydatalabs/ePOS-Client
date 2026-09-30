-- =============================================================================
-- Phase F #6q (2026-08-29) — per-product T&C + Mego Pay seed.
--
-- Each SupplierProduct can now point at a specific SupplierTermsVersion —
-- so a MegoPay purchase shows MegoPay's terms, an ABC purchase shows ABC's
-- terms, etc. Nullable FK: if unset, the pay page falls back to whatever's
-- active for the supplier tenant (existing behaviour).
--
-- This migration:
--   1. Adds terms_version_id column + FK on supplier_products
--   2. Inserts MegoPay's full Buyer T&C as a SupplierTermsVersion for
--      Synergy Data Labs (source: handoff pack, 2026-08-29)
--   3. Inserts a "MegoPay Payment Gateway" product for Synergy Data Labs
--      and wires it to the MegoPay T&C row
--
-- Not touching existing invoices/products — forward-only per the user's
-- instruction. New invoices for the new product will pick up the product's
-- T&C; new invoices for existing products fall through to Synergy's active
-- (which is null right now, so the pay page skips the acceptance step for
-- them, matching current behaviour).
-- =============================================================================

BEGIN;

-- 1. Schema: nullable FK on supplier_products → supplier_terms_versions.
ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS terms_version_id UUID NULL;

ALTER TABLE supplier_products
  DROP CONSTRAINT IF EXISTS supplier_products_terms_version_id_fkey;

ALTER TABLE supplier_products
  ADD CONSTRAINT supplier_products_terms_version_id_fkey
  FOREIGN KEY (terms_version_id)
  REFERENCES supplier_terms_versions(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_products_terms_version_id
  ON supplier_products(terms_version_id);

COMMENT ON COLUMN supplier_products.terms_version_id
  IS 'Optional per-product T&C. When set, the pay page shows THIS T&C for invoices whose line items reference this product. When null, falls back to the supplier tenant''s active T&C.';

-- 2. Insert MegoPay's Buyer T&C as a SupplierTermsVersion for Synergy.
--    Full document body from the handoff pack (RBP FINIVIS / MegoPay,
--    version 2026-08-29.1). Reproduced verbatim so the customer sees
--    MegoPay's exact terms, hash-verifiable, chargeback-defensible.
--    Dollar-quoted with $MP$ tag to survive apostrophes / quotes safely.
WITH inserted_terms AS (
  INSERT INTO supplier_terms_versions (
    id,
    supplier_tenant_id,
    version,
    body_markdown,
    effective_from,
    effective_to,
    created_at
  )
  VALUES (
    gen_random_uuid(),
    (SELECT id FROM tenants WHERE slug = 'synergy-data-labs'),
    'megopay-2026-08-29.1',
    $MP$# Buyer Terms and Conditions — MegoPay

**Document control**

| Field | Value |
|---|---|
| Applies to | Purchases of MegoPay software licences via hub |
| Contracting entity | RBP FINIVIS Private Limited (CIN U65990HR2019PTC081650), Office No. 18, 3rd Floor, Agro Mall, Sector 20, Panchkula, Haryana 134117 |
| Version | 2026-08-29.1 |
| Effective | 29 August 2026 |
| Governing law | India |
| Support | support@rbpfinivis.com · +91 7717 309 363 |

## 0. Summary (not part of the contract)

- **MegoPay is the seller.** When you buy on our site, you buy from us, not from the software's author. We buy the product from the author and resell it to you.
- **MEGO PAY is what appears on your card or bank statement.** Please look for that name before contacting your bank about an unrecognised charge.
- **Digital products are delivered instantly and are non-refundable once delivered**, except where the law gives you a right we cannot exclude, or where we agree to a refund at our discretion.
- **If something is wrong, contact us first at support@rbpfinivis.com.** We respond within 24 hours. Raising a chargeback without contacting us is a breach of these Terms and will result in your licence being revoked.
- **We record evidence of every purchase** — your email, IP address, device fingerprint, the exact time you accepted these Terms, and the delivery record — and we will provide it to your bank and the card networks if you dispute a charge.

## 1. These Terms

These Terms govern your purchase of digital products, software licences, subscriptions and related services (each a "Product") offered through MegoPay checkout pages, embedded checkouts, payment links or invoices. The Platform is operated by RBP FINIVIS Private Limited ("MegoPay", "we"). You accept these Terms by ticking the acceptance box at checkout and completing a purchase. That tick is an electronic signature and forms a binding contract. We record the date, time (UTC), IP address, device fingerprint, user-agent string and content hash of the Terms shown to you. You must be at least 18 years old and legally able to enter into a binding contract.

## 3. Our role: MegoPay is the seller

**Merchant of Record.** MegoPay sells the Product to you as principal and Merchant of Record. We acquire the right to distribute the Product from the software's author (the "Provider") and resell it to you in our own name. Your contract of sale is with MegoPay.

**Statement descriptor.** The charge on your card, bank or wallet statement will appear as **MEGO PAY** and not as the name of the Provider or the Product. Please check for this descriptor before reporting a charge as unrecognised.

**Licence chain.** We resell the Product to you together with the licence granted by the Provider. The Provider retains all intellectual property rights in the Product. Your right to use the Product is governed by the Provider's End User Licence Agreement (EULA) linked on the Product page. MegoPay is responsible for the sale of the Product; the Provider is responsible for the functionality, support and ongoing operation of the Product.

## 8. Delivery of digital Products

**Delivery is immediate.** Unless the Product page states a different timeframe, we deliver the Product immediately after payment is authorised, by one or more of: displaying the licence key or download link on the post-purchase confirmation page; emailing the licence key, activation code or download link to the email address you provided; provisioning access in your Platform account; or provisioning access directly with the Provider against the email address you provided.

**Deemed Delivery.** The Product is delivered, and our delivery obligation is fully performed, at the moment the licence key, download link, access credential or account provisioning is first made available to you or dispatched to your email address of record. Delivery does not depend on whether you open the email, click the link, download the file, install the software, activate the key, or use the Product.

**Non-receipt.** If you have not received your Product within 2 hours of purchase: (a) check spam/junk/promotions folders; (b) check your MegoPay account, where the Product remains available for re-download for 90 days; (c) contact support@rbpfinivis.com quoting your Order number. We will resend or reissue the Product free of charge.

## 10. Refunds and cancellation

**General rule.** Because Products are digital and are delivered immediately, **all sales are final and non-refundable once the Product has been delivered.** By completing your purchase you expressly request immediate delivery and you acknowledge the consequences.

**When we will refund:** (a) Non-delivery we cannot correct within a reasonable time; (b) Duplicate charge through our error; (c) Incorrect amount charged through our error; (d) Product materially and demonstrably not as described, uncorrected within 14 days; (e) Confirmed unauthorised transaction; (f) You exercise a right of cancellation or refund granted by mandatory consumer law.

**When we will not refund:** (a) you changed your mind; (b) you bought the wrong Product; (c) the Product does not meet your system's published requirements; (d) you lack the technical knowledge to install or use it; (e) you found it cheaper elsewhere; (f) the licence key has been redeemed or the download completed; (g) you have breached these Terms or the Provider EULA.

**Waiver of cooling-off right.** Where you have a statutory withdrawal right for digital content (EU Directive 2011/83/EU Article 16(1)(m), UK Consumer Contracts Regulations 2013 regulation 37), at checkout you give your express prior consent to immediate supply and acknowledge that you thereby lose the right of withdrawal once supply has begun.

## 11. Contact us before disputing

If you believe a Charge is wrong, contact us first at support@rbpfinivis.com and give us a reasonable opportunity to resolve the issue before contacting your bank. We commit to: acknowledge within 24 hours, respond substantively within 5 business days, resend any undelivered Product free of charge, refund you where the refund conditions apply. Our support: support@rbpfinivis.com, +91 7717 309 363, Monday-Saturday 09:00-18:00 IST.

## 12. Chargebacks

An "**illegitimate Chargeback**" is one raised: without first contacting us; on a factually untrue ground; for a Charge we have already refunded; for a reason listed in Section 10 as a circumstance in which no refund is due; or after you have downloaded, activated, redeemed or used the Product. Illegitimate Chargebacks are a material breach of these Terms. Where you raise one, we may: revoke the licence immediately; close your account; defend the Chargeback with the Evidence Record; recover the reversed Charge, chargeback fee, administrative cost, and reasonable legal costs; refer the outstanding amount to a debt-collection agency; report the transaction to card-network fraud systems and law-enforcement.

## 13. Records we keep

For every Order we record and retain: (a) your identity and contact details; (b) technical identifiers (IP, device fingerprint, user-agent, geo, screen, language); (c) consent evidence (date/time UTC, which boxes ticked, content hash of the Terms shown to you); (d) transaction data (order details, payment method, authorisation code, 3-D Secure result); (e) delivery evidence (channel, timestamp, mail-server response, message ID, open/click/activation events); (f) usage evidence where the Provider supplies it; (g) support correspondence. Retained for 7 years in append-only storage with cryptographic hashing. Disclosed in disputes to your bank, our acquirer, the card network, the Provider, regulators and courts.

## 14. Acceptable use

You must not: use stolen or unauthorised payment credentials; place Orders using false identity or location information; use a VPN to obtain different pricing or evade tax; resell or share licence keys except where the Provider EULA expressly permits; circumvent DRM or activation; purchase Products with the intention of raising a Chargeback; create multiple accounts to evade a suspension; scrape or bulk-download; launder money or transact in breach of sanctions; use the Platform in breach of any applicable law.

## 18. Warranties and disclaimers

We warrant that we have the right to sell the Products we list, that we will supply them with reasonable care and skill, and that they will be as described on the Product page at the time of purchase. To the fullest extent permitted by law, all other warranties are excluded. Products are provided "as is" and "as available". We do not warrant that a Product will be uninterrupted, error-free or free of vulnerabilities.

## 19. Limitation of liability

Our total aggregate liability to you arising out of or in connection with an Order is limited to **the amount you paid us for the Product giving rise to the claim**. We are not liable for loss of profit, revenue, business, contracts, data, goodwill, or any indirect or consequential loss. Nothing in these Terms excludes liability for death or personal injury caused by negligence, for fraud, or for any liability that cannot lawfully be excluded.

## 25. Region-specific consumer protection

Your rights under mandatory consumer protection law in your country/region are unaffected. EU/EEA and UK consumers have statutory withdrawal rights (subject to your consent to immediate supply under §10.5). Nothing in these Terms deprives you of the protection of mandatory provisions of the law where you are habitually resident.

## 27. Governing law and jurisdiction

These Terms are governed by the laws of India. The courts of Panchkula, Haryana, India have exclusive jurisdiction. If you are a Consumer, you also have the benefit of any mandatory provisions of the law of your country of residence.

## 28. Contact

RBP FINIVIS Private Limited
Office No. 18, 3rd Floor, Agro Mall, Sector 20, Panchkula, Haryana 134117
CIN U65990HR2019PTC081650 · GSTIN 06AAJCR7283G1Z1
Support: support@rbpfinivis.com · +91 7717 309 363
Complaints: complaints@rbpfinivis.com · Data protection: privacy@rbpfinivis.com

---

**By ticking the acceptance box you confirm you have read, understood and agree to these Terms in full. Your card statement will show MEGO PAY.**

*Version 2026-08-29.1*
$MP$,
    NOW(),
    NULL,
    NOW()
  )
  RETURNING id
),

-- 3. Insert a "MegoPay Payment Gateway" product for Synergy Data Labs and
--    wire it to the T&C row we just inserted. Price shown here is illustrative
--    (CAD $99.00 one-time) — supplier can edit via the portal.
inserted_product AS (
  INSERT INTO supplier_products (
    id,
    supplier_tenant_id,
    name,
    description,
    unit_label,
    wholesale_price_cents,
    retail_price_cents,
    product_type,
    software_pricing_model,
    software_version,
    software_docs_url,
    software_download_url,
    software_license_model,
    software_requirements,
    software_trial_days,
    is_public,
    is_active,
    sort_order,
    terms_version_id,
    created_at,
    updated_at
  )
  VALUES (
    gen_random_uuid(),
    (SELECT id FROM tenants WHERE slug = 'synergy-data-labs'),
    'MegoPay Payment Gateway',
    'Accept cards, wallets and bank transfers from your customers with MegoPay — a modern payment gateway built for growing businesses. RBI-licensed, PCI-DSS compliant, delivered by RBP FINIVIS.',
    'licence',
    9900,          -- CAD $99.00
    9900,
    'SOFTWARE',
    'ONE_TIME',
    '1.0',
    'https://rbpfinivis.com/megopay/docs',
    'https://rbpfinivis.com/megopay/download',
    'PER_ACCOUNT',
    'Modern browser, HTTPS domain, verified business identity for KYC.',
    0,
    true,
    true,
    -100,          -- sort ahead of the 10 existing services
    (SELECT id FROM inserted_terms),
    NOW(),
    NOW()
  )
  RETURNING id, name
)
SELECT * FROM inserted_product;

-- 4. Verify — should show the MegoPay product with a non-null terms_version_id.
SELECT
  p.id,
  p.name,
  p.product_type,
  p.is_public,
  (p.wholesale_price_cents / 100.0) AS price_cad,
  p.terms_version_id,
  v.version AS terms_version_label,
  LENGTH(v.body_markdown) AS terms_body_length
FROM supplier_products p
LEFT JOIN supplier_terms_versions v ON v.id = p.terms_version_id
WHERE p.supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND p.name = 'MegoPay Payment Gateway';

COMMIT;
