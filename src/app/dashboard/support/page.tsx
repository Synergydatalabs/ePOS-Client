// Merchant-side dedicated support inbox. Auth is enforced by the layout
// (dashboard/layout.tsx) — if the user isn't signed in as merchant they
// don't get past that shell.
"use client";

import SupportInboxPage from "@/components/support/SupportInboxPage";

export default function DashboardSupportPage() {
  return (
    <div className="p-4 lg:p-8">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">Support</h1>
        <p className="text-sm text-gray-500 mt-1">
          Reach out to the platform team. We&apos;ll reply here and via email.
        </p>
      </header>
      <SupportInboxPage />
    </div>
  );
}
