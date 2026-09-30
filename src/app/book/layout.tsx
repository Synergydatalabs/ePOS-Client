// ============================================================================
// /book layout — applies to ALL public booking pages
//
// Intentionally minimal: no auth checks, no admin shell. Just clean HTML +
// a footer "Powered by ZashX" link (which the tenant can hide via their
// TenantSettings.poweredByVisible flag later).
//
// The tenant-specific page sets its own <title> and brand colors.
// ============================================================================

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Book a Table",
  description: "Reserve your table — choose a time and confirm in seconds.",
  robots: {
    index: true,
    follow: true,
  },
};

export default function BookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50 antialiased">
      {children}
    </div>
  );
}
