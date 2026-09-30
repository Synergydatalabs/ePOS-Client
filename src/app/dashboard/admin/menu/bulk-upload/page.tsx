"use client";

// ============================================================================
// /dashboard/admin/menu/bulk-upload
//
// Page that hosts the MenuCsvUploader. Resolves the active tenant from
// localStorage (matches existing admin pages pattern in this app).
// ============================================================================

import { useState, useEffect } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import MenuCsvUploader from "@/components/admin/MenuCsvUploader";

export default function BulkUploadPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [recentCount, setRecentCount] = useState<number | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  if (!tenantId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Bulk Menu Upload" />
        <div className="max-w-4xl mx-auto px-4 py-12 text-center text-gray-500">
          Loading tenant context...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="Bulk Menu Upload"
        subtitle="Upload your entire menu in seconds. Drop a CSV + an images folder."
      />

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Breadcrumb */}
        <nav className="text-sm mb-4">
          <Link href="/dashboard/admin/menu/products" className="text-indigo-600 hover:underline">
            Menu &amp; Products
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <span className="text-gray-700">Bulk Upload</span>
        </nav>

        {recentCount !== null && (
          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 flex items-center gap-2">
            <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
            Last upload created {recentCount} products successfully.
          </div>
        )}

        {/* Quick guide */}
        <details className="mb-6 rounded-lg bg-white border border-gray-200 p-4 text-sm">
          <summary className="font-medium cursor-pointer text-gray-900 flex items-center gap-2">
            <Icon icon="solar:info-circle-bold" className="w-4 h-4 text-indigo-600" />
            How this works (click to expand)
          </summary>
          <div className="mt-3 space-y-3 text-gray-700">
            <p>
              <strong>Step 1.</strong> Download the CSV template using the button on the next screen.
            </p>
            <p>
              <strong>Step 2.</strong> Fill it in with your products. Required columns: <code className="px-1.5 py-0.5 rounded bg-gray-100">name</code>, <code className="px-1.5 py-0.5 rounded bg-gray-100">category</code>, <code className="px-1.5 py-0.5 rounded bg-gray-100">price</code>.
            </p>
            <p>
              <strong>Step 3.</strong> For each product with an image, put the image filename (e.g.{" "}
              <code className="px-1.5 py-0.5 rounded bg-gray-100">burger.jpg</code>) in the{" "}
              <code className="px-1.5 py-0.5 rounded bg-gray-100">image_filename</code> column. Save all your images in a single folder on your computer.
            </p>
            <p>
              <strong>Step 4.</strong> Pick the CSV file → preview → pick the images folder → confirm.
            </p>
            <p className="text-xs text-gray-500 pt-2 border-t">
              Categories that don&apos;t exist are created automatically. Products with duplicate SKUs are skipped.
            </p>
          </div>
        </details>

        {/* The actual uploader */}
        <MenuCsvUploader
          tenantId={tenantId}
          onSuccess={(count) => setRecentCount(count)}
        />
      </div>
    </div>
  );
}
