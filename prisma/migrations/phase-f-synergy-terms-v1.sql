-- =============================================================================
-- Phase F #6p (2026-08-29) — publish Synergy's Buyer T&C v1 to the T&C table.
--
-- Uploads the full Ontario-adapted Buyer Terms and Conditions as the ACTIVE
-- SupplierTermsVersion for the synergy-data-labs tenant, so hub's pay page
-- starts requiring typed-name acceptance from every customer.
--
-- Source: tap-app/docs/legal/hub-buyer-terms-v1.md (v1 draft, pre-counsel).
-- Idempotent-safe: closes any prior active version, opens the new one.
--
-- IMPORTANT: this is a DRAFT for testing the acceptance flow end-to-end.
-- DO NOT expose to real customers until counsel-reviewed. Placeholder-in-
-- brackets fields (Ontario corp number, office address, HST number, etc.)
-- still need to be filled in — see the "Before publishing" section at the
-- bottom of the source markdown.
-- =============================================================================

BEGIN;

-- 1. Close any currently-active T&C version for Synergy (effectiveTo = NOW()).
UPDATE supplier_terms_versions
SET effective_to = NOW()
WHERE supplier_tenant_id = (SELECT id FROM tenants WHERE slug = 'synergy-data-labs')
  AND effective_to IS NULL;

-- 2. Insert v1 as the new active version.
-- The full body markdown is inlined here as a heredoc-style dollar-quoted
-- string so this migration is self-contained (no file read from disk).
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
  '2026-08-29.1',
  $TERMS$# hub — Buyer Terms and Conditions

**Effective 2026-08-29 · Version 2026-08-29.1**

## 0. Summary (not part of the contract)

- **hub is the seller.** When you buy on hub, you buy from Synergy Data Labs Inc., not from the software's author. We buy the product from the author (the **Vendor**) and resell it to you.
- **SYNERGY DATA LABS is what appears on your card or bank statement.** Please look for that name before contacting your bank about an unrecognised charge.
- **Digital products are delivered instantly and are non-refundable once delivered**, except where the law gives you a right we cannot exclude, or where we agree to a refund at our discretion. See section 10.
- **If something is wrong, contact us first at info@synergydatalabs.com.** We respond within 24 hours. Raising a chargeback without contacting us is a breach of these Terms and will result in your licence being revoked.
- **We record evidence of every purchase** — your email, IP address, device fingerprint, the exact time you accepted these Terms, and the delivery record — and we will provide it to your bank and the card networks if you dispute a charge. See sections 12 and 13.

## 1. These Terms

**1.1** These Terms and Conditions (the "Terms") govern your purchase and use of digital products, software licences, subscriptions, professional services and related digital deliverables (each a "Product") offered through https://hub.synergydatalabs.com and any checkout page, embedded checkout, payment link or invoice operated by us (together, the "Platform").

**1.2** The Platform is operated by Synergy Data Labs Inc., a corporation incorporated in the Province of Ontario, Canada ("Synergy", "hub", "we", "us", "our").

**1.3** "You", "your" and "Buyer" mean the person or entity placing an order through the Platform.

**1.4 Acceptance.** You accept these Terms by ticking the acceptance boxes presented at checkout and completing a purchase. That tick is an electronic signature and forms a binding contract between you and us. We record the date, time (UTC), IP address, device fingerprint, user-agent string and the exact version and content hash of the Terms displayed to you at that moment.

## 3. Our role: hub is the seller

**3.1 Merchant of Record.** Synergy Data Labs Inc. sells the Product to you as principal and Merchant of Record. We acquire the right to distribute the Product from the Vendor and resell it to you in our own name. Your contract of sale is with Synergy Data Labs Inc.

**3.2 Statement descriptor.** The charge on your card, bank or wallet statement will appear as **SYNERGY DATA LABS** — not the name of the Vendor or the Product. Please check for this descriptor before reporting a charge as unrecognised.

**3.3 Licence chain.** We resell the Product to you together with the licence granted by the Vendor. The Vendor retains all intellectual property rights in the Product. Your right to use the Product is governed by the Vendor Terms shown on the Product page. The Vendor is responsible for the functionality, support and ongoing operation of the Product.

## 8. Delivery of digital Products

**8.1 Delivery is immediate.** We deliver the Product immediately after payment is authorised, by one or more of: displaying the licence key or download link on the post-purchase page; emailing it to the address you provided; provisioning access in your account; or provisioning access with the Vendor.

**8.2 Deemed Delivery.** The Product is delivered, and our delivery obligation is fully performed, at the moment the licence key, download link, access credential or account provisioning is first made available to you or dispatched to your email address of record. Delivery does not depend on whether you open the email, click the link, download the file, install the software, activate the key, or use the Product.

## 10. Refunds and cancellation

**10.1 General rule.** All sales are final and non-refundable once the Product has been delivered under section 8. By completing your purchase you expressly request immediate delivery and you acknowledge the consequences.

**10.2 When we will refund.** We will refund you where: (a) Non-delivery we cannot correct within a reasonable time; (b) Duplicate charge through our error; (c) Incorrect amount charged through our error; (d) Product materially and demonstrably not as described, uncorrected within 14 days; (e) Confirmed unauthorised transaction; or (f) You exercise a right of cancellation or refund granted by mandatory consumer law.

**10.3 When we will not refund.** Refunds are not available where: (a) you changed your mind; (b) you bought the wrong Product; (c) the Product does not meet your system's published requirements; (d) you found it cheaper elsewhere; (e) the licence key has been redeemed or the download completed; or (f) you have breached these Terms or the Vendor Terms.

**10.5 Waiver of cooling-off right.** Where you have a statutory withdrawal right for digital content, at checkout you give your express prior consent to immediate supply and acknowledge that you thereby lose the right of withdrawal once supply has begun.

## 11. Contact us before disputing

**11.1** If you believe a Charge is wrong, contact us first at info@synergydatalabs.com and give us a reasonable opportunity to resolve the issue before contacting your bank.

**11.2** We commit to acknowledge within 24 hours, respond substantively within 5 business days, resend any undelivered Product free of charge, and refund you where section 10.2 applies.

## 12. Chargebacks

**12.2 Illegitimate Chargebacks** — raised without first contacting us, or on factually untrue grounds, or after downloading/activating/using the Product, or for a reason listed in 10.3 — are a material breach of these Terms. Where you raise an illegitimate Chargeback we may: revoke the licence; close your account; defend the Chargeback with the Evidence Record; recover the reversed amount, our processor's chargeback fee (currently CAD 15.00), our administrative cost (currently CAD 50.00), and reasonable legal costs; refer the outstanding amount to collections; and report the transaction to fraud-reporting systems.

## 13. Evidence Record

For every Order we record and retain: your identity and contact details; technical identifiers (IP, device fingerprint, user-agent, geo); consent evidence (which boxes you ticked, when, and the version and content hash of the Terms shown to you at that moment); transaction data; delivery evidence; usage evidence where the Vendor supplies it; and support correspondence. Retained for 7 years. In a dispute we will submit this Evidence Record to your issuing bank, our acquiring bank, the relevant card network, the Vendor, any regulator, and any court or tribunal.

## 18. Warranties and disclaimers

**18.2** To the fullest extent permitted by law, and subject to section 25, all warranties other than those in 18.1 are excluded. Products are provided "as is" and "as available". We do not warrant that a Product will be uninterrupted, error-free, or that it will meet your particular requirements.

**18.4** Nothing in these Terms excludes liability for death or personal injury caused by negligence, for fraud, or for any liability that cannot lawfully be excluded.

## 19. Limitation of liability

**19.1** Our total aggregate liability for an Order is limited to the amount you paid us for the Product giving rise to the claim.

**19.2** We are not liable for loss of profit, revenue, business, contracts, data, or goodwill, or any indirect or consequential loss.

## 25. Region-specific consumer protection

Your rights under Canadian federal consumer protection law and provincial consumer protection legislation are unaffected. Quebec residents: the Consumer Protection Act (Quebec) applies, these Terms are governed by Quebec law for you, you may bring proceedings in Quebec courts, and a French translation is available on request. EU/EEA and UK consumers: your statutory withdrawal rights under Directive 2011/83/EU / the Consumer Contracts Regulations 2013 apply, subject to your consent to immediate supply under §10.5.

## 27. Governing law

These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada. Subject to §25, the courts of Ontario have exclusive jurisdiction.

## 28. Contact

Synergy Data Labs Inc.
Ontario, Canada
Support: info@synergydatalabs.com
Complaints: info@synergydatalabs.com (mark "Formal complaint")

## Appendix A — Checkout consent

At checkout you tick three separate boxes:
1. I have read and accept the hub Terms & Conditions and Refund Policy.
2. I request immediate supply and understand I lose my cooling-off right once supply begins.
3. I acknowledge this purchase is non-refundable once the Product is delivered.

You also type your full legal name as an electronic signature.

Your card statement will show **SYNERGY DATA LABS**.

---

*Version 2026-08-29.1. Full document: hub.synergydatalabs.com/legal/terms. This is a draft pending Canadian legal counsel review — not final until countersigned.*
$TERMS$,
  NOW(),
  NULL,
  NOW()
);

-- 3. Verify: show the currently-active version for Synergy.
SELECT
  v.version,
  v.effective_from,
  v.effective_to,
  LENGTH(v.body_markdown) AS body_length,
  ENCODE(digest(v.body_markdown, 'sha256'), 'hex') AS body_hash
FROM supplier_terms_versions v
JOIN tenants t ON t.id = v.supplier_tenant_id
WHERE t.slug = 'synergy-data-labs'
  AND v.effective_to IS NULL;

COMMIT;
