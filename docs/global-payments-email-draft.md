# Email to Global Payments — QR Checkout & Online Payment Keys

---

**To:** [Global Payments Focal Point]
**Subject:** Additional Credential Request — QR Checkout & Online (Card-Not-Present) Payment Integration

---

Hi [Name],

Hope you're doing well. We've successfully integrated and tested the **Global Payments UPA terminal** solution into our POS platform (iTAP by ZashX). Physical card terminals are up and running — chip, tap, and swipe are all operational in our sandbox environment.

We're now looking to expand our payment capabilities to cover two additional channels and would appreciate your guidance on the credentials and configuration needed:

### 1. QR Code Checkout (Scan-to-Pay)

We'd like to offer a **QR-based checkout** experience where customers can scan a QR code at the counter or on a receipt to complete payment on their phone. This would be used in our restaurant, salon, and retail POS scenarios.

**What we need from you:**
- API credentials (App ID / App Key) for QR-based payment processing
- Documentation on the QR payment flow (generate QR > customer scans > payment confirmed)
- Supported payment methods via QR (credit/debit, digital wallets, etc.)
- Any additional merchant configuration required on your end

### 2. Online / Card-Not-Present (CNP) Payments

We also need to process **online payments** for:
- Customer deposits and prepayments (salon bookings, ride fares)
- Invoice payments (emailed to customers with a "Pay Now" link)
- In-app ride payments (our cab/transport vertical — Dash Rides)

We currently have sandbox GP-API credentials (`APP_ID` and `APP_KEY`) and Realex XML gateway sandbox credentials. We need:
- **Production credentials** for GP-API (Card-Not-Present / ECOM)
- Confirmation on whether our existing sandbox App ID can be promoted to production, or if new credentials are required
- Any PCI compliance requirements or hosted payment page options for CNP
- 3D Secure / SCA configuration for online card transactions
- Tokenization setup for recurring / stored card payments

### Our Platform Overview

iTAP is a multi-tenant POS and business management platform serving four verticals:
- **Restaurants** — dine-in, takeout, delivery
- **Salons** — appointment booking and checkout
- **Retail** — standard retail POS
- **Cab/Transport** — ride dispatch, fare collection

All verticals share the same payment infrastructure. We're based in Canada (CAD primary currency) with plans to support USD.

### Current Integration Status

| Channel | Status | Credentials |
|---------|--------|-------------|
| UPA Terminal (Card Present) | Working (Sandbox) | Configured |
| GP-API Online (CNP) | Code Ready | Sandbox keys available |
| XML/Realex Gateway | Code Ready | Sandbox keys available |
| QR Checkout | Not started | Need credentials & docs |

Please let us know the next steps to get QR checkout credentials and promote our online payment setup to production. Happy to schedule a call if that would be easier.

Thanks,
[Your Name]
ZashX Inc.
