"use client";

// Platform admin — gateway application queue.
//
// Shows every application across every supplier tenant. Status tabs +
// search. Row click → detail view.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

type Status =
  | "DRAFT"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "FORWARDED"
  | "INFO_REQUESTED"
  | "APPROVED"
  | "REJECTED";

interface AppRow {
  id: string;
  status: Status;
  targetProcessor: "GP" | "MONERIS" | "STRIPE" | null;
  legalName: string;
  dbaName: string | null;
  incorporationRegion: string | null;
  projectedMonthlyVolumeCents: number | null;
  currency: string;
  submittedAt: string;
  forwardedAt: string | null;
  approvedAt: string | null;
  reviewedByAdminEmail: string | null;
  forwardedToEmail: string | null;
  supplierName: string;
  supplierContactEmail: string;
  supplierTenant: { id: string };
}

interface Counts {
  DRAFT?: number;
  SUBMITTED?: number;
  IN_REVIEW?: number;
  FORWARDED?: number;
  INFO_REQUESTED?: number;
  APPROVED?: number;
  REJECTED?: number;
}

const STATUS_TABS: {
  key: "" | Status;
  label: string;
  countKey?: keyof Counts;
}[] = [
  { key: "", label: "All" },
  { key: "SUBMITTED", label: "New", countKey: "SUBMITTED" },
  { key: "IN_REVIEW", label: "In review", countKey: "IN_REVIEW" },
  { key: "INFO_REQUESTED", label: "Info requested", countKey: "INFO_REQUESTED" },
  { key: "FORWARDED", label: "With processor", countKey: "FORWARDED" },
  { key: "APPROVED", label: "Approved", countKey: "APPROVED" },
  { key: "REJECTED", label: "Rejected", countKey: "REJECTED" },
];

const STATUS_STYLES: Record<Status, { bg: string; text: string; label: string }> = {
  DRAFT:          { bg: "bg-gray-100",    text: "text-gray-700",    label: "Draft" },
  SUBMITTED:      { bg: "bg-blue-100",    text: "text-blue-800",    label: "New" },
  IN_REVIEW:      { bg: "bg-indigo-100",  text: "text-indigo-800",  label: "In review" },
  FORWARDED:      { bg: "bg-purple-100",  text: "text-purple-800",  label: "With processor" },
  INFO_REQUESTED: { bg: "bg-amber-100",   text: "text-amber-900",   label: "Info requested" },
  APPROVED:       { bg: "bg-emerald-100", text: "text-emerald-800", label: "Approved" },
  REJECTED:       { bg: "bg-red-100",     text: "text-red-800",     label: "Rejected" },
};

export default function GatewayApplicationsPage() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const [activeStatus, setActiveStatus] = useState<"" | Status>("");
  const [searchQuery, setSearchQuery] = useState("");

  const load = () => {
    const params = new URLSearchParams();
    if (activeStatus) params.set("status", activeStatus);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    const query = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/platform/gateway-applications${query}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setApps(data.applications);
          setCounts(data.counts || {});
        } else {
          toast.error(data.error || "Failed to load queue");
        }
      })
      .catch(() => toast.error("Failed to load queue"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStatus]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const money = (cents: number | null, currency: string) =>
    cents == null
      ? "—"
      : `${currency} ${(cents / 100).toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })}`;

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
          Gateway Applications
        </h1>
        <p className="text-gray-500 mt-1">
          Review + route supplier payment gateway applications to processors.
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1">
        {STATUS_TABS.map((tab) => {
          const count = tab.countKey ? counts[tab.countKey] || 0 : undefined;
          const active = activeStatus === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveStatus(tab.key)}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors flex-shrink-0 ${
                active
                  ? "bg-slate-900 text-white"
                  : "bg-white text-gray-700 border border-gray-200 hover:bg-gray-50"
              }`}
            >
              {tab.label}
              {count != null && (
                <span
                  className={`text-xs px-1.5 py-0 rounded-full ${
                    active ? "bg-white/20" : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="mb-5">
        <div className="relative max-w-md">
          <Icon
            icon="solar:magnifer-linear"
            className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
          />
          <input
            type="text"
            placeholder="Search by business name…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-slate-500 focus:border-transparent outline-none text-sm"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : apps.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <Icon
            icon="solar:inbox-linear"
            className="w-14 h-14 text-gray-300 mx-auto mb-3"
          />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            {activeStatus || searchQuery ? "No applications match" : "No applications yet"}
          </h2>
          <p className="text-sm text-gray-500">
            {activeStatus || searchQuery
              ? "Try clearing the filter."
              : "Suppliers who apply for a payment gateway will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {apps.map((a) => {
            const style = STATUS_STYLES[a.status];
            return (
              <Link
                key={a.id}
                href={`/platform/gateway-applications/${a.id}`}
                className="block bg-white rounded-2xl border border-gray-200 p-5 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-semibold text-gray-900 truncate">{a.legalName}</h3>
                      {a.dbaName && (
                        <span className="text-sm text-gray-500 truncate">({a.dbaName})</span>
                      )}
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.bg} ${style.text}`}
                      >
                        {style.label}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 truncate">
                      Supplier: {a.supplierName} · {a.supplierContactEmail}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span>
                        Submitted {new Date(a.submittedAt).toLocaleDateString()}
                      </span>
                      {a.targetProcessor && (
                        <span>
                          <strong className="text-gray-700">→</strong> {a.targetProcessor}
                        </span>
                      )}
                      {a.incorporationRegion && (
                        <span>
                          {a.incorporationRegion}
                        </span>
                      )}
                      {a.projectedMonthlyVolumeCents != null && (
                        <span>
                          ~{money(a.projectedMonthlyVolumeCents, a.currency)}/mo
                        </span>
                      )}
                      {a.reviewedByAdminEmail && (
                        <span className="text-gray-400">
                          Last reviewed by {a.reviewedByAdminEmail}
                        </span>
                      )}
                    </div>
                  </div>
                  <Icon
                    icon="solar:alt-arrow-right-linear"
                    className="w-5 h-5 text-gray-400 flex-shrink-0"
                  />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
