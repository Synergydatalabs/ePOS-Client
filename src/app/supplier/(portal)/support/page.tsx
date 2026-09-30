// Supplier-side dedicated support inbox. Same component the merchant
// portal uses — the server figures out who's calling from the session
// cookie, so the widget doesn't need to know.
"use client";

import SupportInboxPage from "@/components/support/SupportInboxPage";

export default function SupplierSupportPage() {
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
