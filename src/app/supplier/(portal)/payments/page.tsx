"use client";

// /supplier/payments — the payments hub for a supplier.
//
// Dispatches based on state:
//   - No application + no active processor  → "Apply for a payment gateway" CTA
//   - Application in-flight (SUBMITTED / IN_REVIEW / FORWARDED / INFO_REQUESTED)
//        → status card showing progress
//   - Application APPROVED with an active processor
//        → "You're live" success card with processor info
//   - Application REJECTED
//        → rejection reason + "Apply again" CTA
//
// Sensitive fields are never rendered here — this is the public-inside-the-
// portal overview page. Review of submitted data is on the detail sub-page.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

type AppStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "IN_REVIEW"
  | "FORWARDED"
  | "INFO_REQUESTED"
  | "APPROVED"
  | "REJECTED";

interface AppRow {
  id: string;
  status: AppStatus;
  targetProcessor: "GP" | "MONERIS" | "STRIPE" | null;
  legalName: string;
  submittedAt: string;
  forwardedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  infoRequestedAt: string | null;
  infoRequested: string | null;
  rejectionReason: string | null;
  forwardedToEmail: string | null;
  processorReferenceId: string | null;
}

interface ActiveProcessor {
  id: string;
  processor: "GP" | "MONERIS" | "STRIPE";
  externalMid: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED";
  activatedAt: string | null;
  feeScheduleJson: { percentBps?: number; fixedCents?: number } | null;
}

const STATUS_STYLES: Record<AppStatus, { bg: string; text: string; label: string }> = {
  DRAFT:          { bg: "bg-gray-100",    text: "text-gray-700",    label: "Draft" },
  SUBMITTED:      { bg: "bg-blue-100",    text: "text-blue-800",    label: "Submitted" },
  IN_REVIEW:      { bg: "bg-indigo-100",  text: "text-indigo-800",  label: "In review" },
  FORWARDED:      { bg: "bg-purple-100",  text: "text-purple-800",  label: "With processor" },
  INFO_REQUESTED: { bg: "bg-amber-100",   text: "text-amber-900",   label: "Action needed" },
  APPROVED:       { bg: "bg-emerald-100", text: "text-emerald-800", label: "Approved" },
  REJECTED:       { bg: "bg-red-100",     text: "text-red-800",     label: "Rejected" },
};

export default function SupplierPaymentsPage() {
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState<AppRow[]>([]);
  const [activeProcessor, setActiveProcessor] = useState<ActiveProcessor | null>(null);

  useEffect(() => {
    fetch("/api/supplier/gateway/applications")
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setApplications(data.applications || []);
          setActiveProcessor(data.activeProcessor || null);
        } else {
          toast.error(data.error || "Failed to load payments");
        }
      })
      .catch(() => toast.error("Failed to load payments"))
      .finally(() => setLoading(false));
  }, []);

  const latestApp = applications[0] || null;
  const inflightStatuses: AppStatus[] = [
    "SUBMITTED",
    "IN_REVIEW",
    "FORWARDED",
    "INFO_REQUESTED",
  ];
  const inflight = latestApp && inflightStatuses.includes(latestApp.status);

  if (loading) {
    return (
      <div className="p-6 lg:p-10 max-w-4xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-1/3" />
          <div className="h-48 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Payments</h1>
          <p className="text-gray-500 mt-1">
            Accept card payments from merchants directly on their purchase orders.
          </p>
        </div>
        {/* Phase F #6d (2026-08-27): direct entry to BYO-Stripe settings.
            Sits alongside the legacy gateway-application flow — either path
            gets a supplier live. */}
        <Link
          href="/supplier/settings/payments"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-teal-200 text-sm font-semibold text-teal-800 bg-white hover:bg-teal-50 flex-shrink-0"
        >
          <Icon icon="solar:key-bold-duotone" className="w-4 h-4" />
          Configure Stripe keys
        </Link>
      </div>

      {/* PATH 1 — no active processor + no in-flight application → apply */}
      {!activeProcessor && !inflight && (
        <div className="bg-white rounded-2xl border border-gray-200 p-8">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <Icon icon="solar:card-transfer-bold" className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-gray-900 mb-2">
                Apply for a payment gateway
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Once approved, every purchase order you receive gets a payment link
                the merchant can click to pay by card. Funds settle directly to
                your bank — the platform doesn't sit in the middle.
              </p>
              <div className="mb-6">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  What you'll need
                </h3>
                <ul className="text-sm text-gray-700 space-y-1.5">
                  <li className="flex items-start gap-2">
                    <Icon icon="solar:check-circle-linear" className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                    Legal business name, incorporation info, and address
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon icon="solar:check-circle-linear" className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                    Tax ID (EIN / BN) + bank account info for deposits
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon icon="solar:check-circle-linear" className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                    Beneficial owner details (anyone with ≥25% ownership)
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon icon="solar:check-circle-linear" className="w-4 h-4 text-indigo-500 mt-0.5 flex-shrink-0" />
                    A signer with authority to open the account
                  </li>
                </ul>
              </div>
              <div className="p-3 rounded-xl bg-indigo-50/60 border border-indigo-100 text-xs text-indigo-900 mb-6 flex items-start gap-2">
                <Icon icon="solar:shield-check-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  Sensitive fields (tax ID, banking, ID numbers) are encrypted at
                  rest with AES-256. Only our review team can decrypt them, and
                  only when reviewing your application.
                </span>
              </div>
              <Link
                href="/supplier/payments/apply"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold text-sm hover:bg-indigo-700"
              >
                <Icon icon="solar:arrow-right-linear" className="w-4 h-4" />
                Start Application
              </Link>
            </div>
          </div>

          {/* Reject history — if this supplier had a REJECTED app previously,
              show a small reference so they know why they're re-applying. */}
          {latestApp?.status === "REJECTED" && latestApp.rejectionReason && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                Last submission was rejected
              </p>
              <p className="text-sm text-gray-700">{latestApp.rejectionReason}</p>
            </div>
          )}
        </div>
      )}

      {/* PATH 2 — application in-flight → status card */}
      {inflight && latestApp && (
        <InflightStatusCard app={latestApp} />
      )}

      {/* PATH 3 — active processor → success card */}
      {activeProcessor && (
        <ActiveProcessorCard processor={activeProcessor} />
      )}

      {/* Application history — if there's more than the latest, list them */}
      {applications.length > 1 && (
        <div className="mt-8">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Application history
          </h3>
          <div className="space-y-2">
            {applications.slice(1).map((app) => {
              const style = STATUS_STYLES[app.status];
              return (
                <Link
                  key={app.id}
                  href={`/supplier/payments/${app.id}`}
                  className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">
                        {app.legalName}
                      </p>
                      <p className="text-xs text-gray-500">
                        Submitted {new Date(app.submittedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${style.bg} ${style.text} flex-shrink-0`}
                    >
                      {style.label}
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- In-flight status card ----------

function InflightStatusCard({ app }: { app: AppRow }) {
  const style = STATUS_STYLES[app.status];

  // Timeline steps — filled based on which timestamps are set. Purely
  // presentational — the real state machine is enforced server-side.
  const steps = [
    { label: "Submitted", at: app.submittedAt, done: !!app.submittedAt },
    { label: "In review", at: null, done: app.status !== "SUBMITTED" },
    {
      label: "With processor",
      at: app.forwardedAt,
      done: !!app.forwardedAt || app.status === "APPROVED",
    },
    { label: "Approved", at: app.approvedAt, done: app.status === "APPROVED" },
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6 lg:p-8">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{app.legalName}</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Submitted {new Date(app.submittedAt).toLocaleString()}
          </p>
        </div>
        <span
          className={`text-xs px-2.5 py-1 rounded-full font-semibold ${style.bg} ${style.text}`}
        >
          {style.label}
        </span>
      </div>

      {/* INFO_REQUESTED — the admin needs something from you */}
      {app.status === "INFO_REQUESTED" && app.infoRequested && (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 mb-4">
          <div className="flex items-start gap-2 mb-2">
            <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <p className="font-semibold text-amber-900">Action needed</p>
          </div>
          <p className="text-sm text-amber-900 whitespace-pre-wrap mb-3">
            {app.infoRequested}
          </p>
          <p className="text-xs text-amber-700">
            Reply to our email or submit a new application with the corrected info.
          </p>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-2 mb-6">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                s.done
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {s.done ? "✓" : i + 1}
            </div>
            <div className="flex-1 flex items-center justify-between">
              <span className={s.done ? "text-gray-900 font-medium" : "text-gray-500"}>
                {s.label}
              </span>
              {s.at && (
                <span className="text-xs text-gray-400">
                  {new Date(s.at).toLocaleDateString()}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {app.forwardedToEmail && (
        <p className="text-xs text-gray-500 mb-4">
          Forwarded to {app.forwardedToEmail}
        </p>
      )}

      <div className="flex items-center gap-3 pt-4 border-t border-gray-100">
        <Link
          href={`/supplier/payments/${app.id}`}
          className="text-sm font-medium text-indigo-600 hover:underline"
        >
          Review submission →
        </Link>
      </div>
    </div>
  );
}

// ---------- Active processor card ----------

function ActiveProcessorCard({ processor }: { processor: ActiveProcessor }) {
  const feePct =
    processor.feeScheduleJson?.percentBps != null
      ? (processor.feeScheduleJson.percentBps / 100).toFixed(2)
      : null;
  const feeFixed =
    processor.feeScheduleJson?.fixedCents != null
      ? (processor.feeScheduleJson.fixedCents / 100).toFixed(2)
      : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-br from-emerald-500 to-green-600 p-6 text-white">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
            <Icon icon="solar:check-circle-bold" className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-bold">You're live on {processor.processor}</h2>
            <p className="text-sm text-white/90">
              New purchase orders will include a payment link automatically.
            </p>
          </div>
        </div>
      </div>
      <div className="p-6 space-y-3">
        <Row label="Processor" value={processor.processor} />
        <Row label="Merchant ID" value={processor.externalMid} mono />
        {processor.activatedAt && (
          <Row
            label="Activated"
            value={new Date(processor.activatedAt).toLocaleDateString()}
          />
        )}
        {(feePct != null || feeFixed != null) && (
          <Row
            label="Processing fee"
            value={
              [feePct != null ? `${feePct}%` : null, feeFixed != null ? `+ $${feeFixed}` : null]
                .filter(Boolean)
                .join(" ") || "See agreement"
            }
          />
        )}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-900 font-medium ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
