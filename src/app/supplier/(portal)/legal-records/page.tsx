"use client";

// =============================================================================
// /supplier/legal-records — supplier's T&C acceptance ledger.
//
// One row per acceptance capture. Columns:
//   Customer   — name + email that clicked accept
//   Invoice    — invoice number + amount (if linked)
//   Version    — T&C version accepted
//   When       — timestamp
//   Where      — IP + geo (if resolved)
//   Actions    — Download certificate (opens printable HTML → Save as PDF)
//
// Chargeback-defense record: this is the page a supplier's ops/legal team
// visits when a customer disputes a charge, to pull the signed acceptance
// on the spot.
// =============================================================================

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

const TEAL = "#0F766E";
const NAVY = "#0F172A";

interface Acceptance {
  id: string;
  invoiceId: string | null;
  acceptedName: string;
  acceptedEmail: string;
  termsVersion: string;
  termsHash: string;
  ipAddress: string | null;
  geoCountry: string | null;
  geoRegion: string | null;
  geoCity: string | null;
  acceptedAt: string;
  invoice: {
    invoiceNumber: string;
    totalCents: number;
    currency: string;
  } | null;
}

function money(cents: number, ccy: string) {
  return `${ccy} ${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function shortDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function LegalRecordsPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Acceptance[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/supplier/terms/acceptances")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setRows(data.acceptances || []);
        else toast.error(data.error || "Failed to load records");
      })
      .catch(() => toast.error("Failed to load records"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? rows.filter((r) => {
        const q = search.trim().toLowerCase();
        return (
          r.acceptedName.toLowerCase().includes(q) ||
          r.acceptedEmail.toLowerCase().includes(q) ||
          r.termsVersion.toLowerCase().includes(q) ||
          (r.invoice?.invoiceNumber || "").toLowerCase().includes(q)
        );
      })
    : rows;

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold" style={{ color: NAVY }}>
          Legal records
        </h1>
        <p className="text-gray-500 mt-1">
          Every time a customer accepts your Terms &amp; Conditions on a pay page,
          we record the who, when, where, and exactly-what-they-agreed-to.
          Download any certificate as PDF for chargeback disputes.
        </p>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Icon
            icon="solar:magnifer-linear"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, invoice, or version"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ ["--tw-ring-color" as any]: TEAL }}
          />
        </div>
        <Link
          href="/supplier/terms"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          <Icon icon="solar:document-text-linear" className="w-4 h-4" />
          Edit T&amp;C
        </Link>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3 animate-pulse">
            <div className="h-4 bg-gray-100 rounded w-2/3" />
            <div className="h-4 bg-gray-100 rounded w-3/4" />
            <div className="h-4 bg-gray-100 rounded w-1/2" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center">
            <div
              className="w-12 h-12 mx-auto mb-4 rounded-full flex items-center justify-center"
              style={{ backgroundColor: `${TEAL}1A` }}
            >
              <Icon icon="solar:shield-check-bold-duotone" className="w-6 h-6" style={{ color: TEAL }} />
            </div>
            <p className="font-semibold text-gray-900">No acceptances yet</p>
            <p className="text-sm text-gray-500 mt-1 max-w-md mx-auto">
              Once you publish a T&amp;C version and a customer accepts it while
              paying an invoice, their signed record appears here.
            </p>
            <Link
              href="/supplier/terms"
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-lg text-sm font-semibold text-white"
              style={{ backgroundColor: TEAL }}
            >
              <Icon icon="solar:arrow-right-linear" className="w-4 h-4" />
              Publish your T&amp;C
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr className="text-xs uppercase tracking-wide text-gray-500">
                  <th className="text-left px-4 py-3 font-semibold">Customer</th>
                  <th className="text-left px-4 py-3 font-semibold">Invoice</th>
                  <th className="text-left px-4 py-3 font-semibold">Version</th>
                  <th className="text-left px-4 py-3 font-semibold">Accepted</th>
                  <th className="text-left px-4 py-3 font-semibold">Where</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((r) => {
                  const geo =
                    [r.geoCity, r.geoRegion, r.geoCountry]
                      .filter(Boolean)
                      .join(", ") || r.ipAddress || "—";
                  return (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{r.acceptedName}</p>
                        <p className="text-xs text-gray-500">{r.acceptedEmail}</p>
                      </td>
                      <td className="px-4 py-3">
                        {r.invoice ? (
                          <>
                            <p className="font-mono text-gray-900">{r.invoice.invoiceNumber}</p>
                            <p className="text-xs text-gray-500">
                              {money(r.invoice.totalCents, r.invoice.currency)}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold font-mono"
                          style={{ backgroundColor: `${TEAL}1A`, color: TEAL }}
                        >
                          {r.termsVersion}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {shortDate(r.acceptedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-700 text-xs">{geo}</p>
                        {r.ipAddress && (
                          <p className="text-xs text-gray-400 font-mono">{r.ipAddress}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`/api/supplier/terms/acceptances/${r.id}/download`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          <Icon icon="solar:download-minimalistic-linear" className="w-3.5 h-3.5" />
                          Certificate
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {rows.length > 0 && (
        <p className="mt-4 text-xs text-gray-500 text-center">
          Showing {filtered.length} of {rows.length} record{rows.length !== 1 ? "s" : ""}.
          Each certificate opens in a new tab — press "Save as PDF" from the toolbar.
        </p>
      )}
    </div>
  );
}
