// Public privacy policy page for the Oreugo POS mobile app.
//
// Play Store requires a public HTTPS URL that describes what user data
// the app collects and how it's protected. Linked from the Play Console
// listing at Store presence → Privacy policy.
//
// Also served at /privacy.html for direct anchors from marketing pages.

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Oreugo POS",
  description:
    "How Oreugo POS collects, stores, and protects merchant and customer data.",
};

export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: "40px auto",
        padding: "0 20px",
        color: "#1a1a1a",
        lineHeight: 1.6,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <h1
        style={{
          color: "#195937",
          borderBottom: "2px solid #195937",
          paddingBottom: 8,
        }}
      >
        Privacy Policy — Oreugo POS
      </h1>
      <p style={{ color: "#666", fontSize: "0.9em", marginBottom: 32 }}>
        Last updated: August 20, 2026
      </p>

      <p>
        Oreugo POS (&quot;the app&quot;) is a point-of-sale application for
        staff of businesses that subscribe to the Oreugo platform. This policy
        explains what information the app collects, how it&apos;s used, and how
        it&apos;s protected.
      </p>

      <Section title="Who uses the app">
        Oreugo POS is used by owners and staff of Oreugo merchant accounts. The
        app is not intended for use by consumers or the general public.
      </Section>

      <h2 style={h2Style}>Information we collect</h2>
      <ul style={ulStyle}>
        <li>
          <strong>Account credentials</strong> — the email and password you sign
          in with, used to authenticate you against your Oreugo merchant
          account.
        </li>
        <li>
          <strong>Session tokens</strong> — a secure JSON Web Token stored on
          the device using Android&apos;s EncryptedSharedPreferences so you
          don&apos;t have to sign in every time you open the app.
        </li>
        <li>
          <strong>Business operations data</strong> — orders you create, items
          rung up, payments taken, cash drawer sessions, time-clock entries, and
          daily sales reports. This data belongs to your merchant account and is
          stored on Oreugo servers under that account.
        </li>
        <li>
          <strong>Customer contact information</strong> — when you attach a
          customer to an order (name, phone, email), that information is stored
          on the order record on behalf of your merchant account.
        </li>
      </ul>

      <h2 style={h2Style}>Information we do NOT collect</h2>
      <ul style={ulStyle}>
        <li>Your device&apos;s location</li>
        <li>Camera or microphone data</li>
        <li>Contacts, photos, or files outside the app</li>
        <li>Advertising identifiers or third-party analytics</li>
        <li>
          Your customers&apos; payment card numbers — card payments are
          processed directly by our card processing partners (see below); we do
          not see or store card numbers.
        </li>
      </ul>

      <h2 style={h2Style}>How we store and protect your data</h2>
      <ul style={ulStyle}>
        <li>
          All network traffic between the app and Oreugo servers is encrypted
          over HTTPS (TLS 1.2+).
        </li>
        <li>
          Session tokens on your device are stored in Android&apos;s
          EncryptedSharedPreferences, backed by the Android Keystore.
        </li>
        <li>
          Business data on Oreugo servers is stored in Amazon Aurora databases
          running inside a private cloud network with restricted access.
        </li>
        <li>
          Only authorized Oreugo staff with a legitimate operational need can
          access production data, and access is logged.
        </li>
      </ul>

      <h2 style={h2Style}>Third-party services</h2>
      <p>The app relies on the following third parties to function:</p>
      <ul style={ulStyle}>
        <li>
          <strong>Global Payments (UCI)</strong> — processes card-present
          payments when your business is configured with a Global Payments
          terminal.
        </li>
        <li>
          <strong>Moneris</strong> — processes card-present payments (DX8000
          terminal) and hosted checkout QR code payments (Moneris Checkout).
        </li>
        <li>
          <strong>Amazon Web Services</strong> — hosts the Oreugo backend,
          database, and file storage in the Canada (Central) region.
        </li>
      </ul>
      <p>
        Card payment details are transmitted directly from the customer&apos;s
        card / terminal to the payment processor and are never seen or stored
        by Oreugo.
      </p>

      <h2 style={h2Style}>Data sharing</h2>
      <p>
        Oreugo does not sell your data or your customers&apos; data to any
        third party. We share data only:
      </p>
      <ul style={ulStyle}>
        <li>
          With the payment processor you have configured, to process a
          transaction you initiate.
        </li>
        <li>
          When required to comply with applicable law or a valid legal request.
        </li>
      </ul>

      <h2 style={h2Style}>Data retention and deletion</h2>
      <p>
        Business data stays associated with your merchant account for as long
        as the account is active. To request deletion of specific records or of
        your entire account, contact us at the email below. Deletion requests
        are processed within 30 days.
      </p>

      <h2 style={h2Style}>Children</h2>
      <p>
        Oreugo POS is a business tool intended for people aged 18 and over. It
        is not directed to children under 13, and we do not knowingly collect
        information from children.
      </p>

      <h2 style={h2Style}>Changes to this policy</h2>
      <p>
        If we make material changes to this policy, we will update the
        &quot;Last updated&quot; date at the top of this page and, where
        appropriate, notify merchants through the app or by email.
      </p>

      <h2 style={h2Style}>Contact</h2>
      <p>
        Questions or requests:{" "}
        <a href="mailto:support@oreugo.ca" style={{ color: "#195937" }}>
          support@oreugo.ca
        </a>
      </p>
    </main>
  );
}

const h2Style: React.CSSProperties = {
  color: "#202F27",
  marginTop: 32,
};

const ulStyle: React.CSSProperties = {
  paddingLeft: 24,
};

// Small helper for the first section so the intro paragraph doesn't stand alone.
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <h2 style={h2Style}>{title}</h2>
      <p>{children}</p>
    </>
  );
}
