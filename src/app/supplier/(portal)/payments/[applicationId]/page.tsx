"use client";

// Read-only review of a submitted application. Sensitive fields render as
// masked previews (••••1234) — full values never come back over the network
// after submission. If supplier needs to correct data, they submit a new
// application (or admin uses INFO_REQUESTED to ask for a specific change).

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

interface AppDetail {
  id: string;
  status: Status;
  targetProcessor: string | null;

  legalName: string;
  dbaName: string | null;
  businessTypeName: string | null;
  incorporationDate: string | null;
  incorporationRegion: string | null;
  businessAddress: {
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postalCode?: string;
    country?: string;
  } | null;
  websiteUrl: string | null;
  mccCode: string | null;

  projectedMonthlyVolumeCents: number | null;
  averageTicketCents: number | null;
  currency: string;

  taxIdMasked: string | null;
  bank: {
    accountHolderName: string | null;
    bankName: string | null;
    routingNumberMasked: string | null;
    accountNumberMasked: string | null;
  } | null;
  beneficialOwners: {
    name: string | null;
    dob: string | null;
    address: string | null;
    ownershipPct: number | null;
    idNumberMasked: string | null;
  }[];

  signerName: string | null;
  signerTitle: string | null;
  signerEmail: string | null;
  signerConsentedAt: string | null;

  adminNotes: string | null;
  forwardedToEmail: string | null;
  processorReferenceId: string | null;
  rejectionReason: string | null;
  infoRequested: string | null;

  submittedAt: string;
  forwardedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;

  decryptError: string | null;
}

const STATUS_STYLES: Record<Status, { bg: string; text: string; label: string }> = {
  DRAFT:          { bg: "bg-gray-100",    text: "text-gray-700",    label: "Draft" },
  SUBMITTED:      { bg: "bg-blue-100",    text: "text-blue-800",    label: "Submitted" },
  IN_REVIEW:      { bg: "bg-indigo-100",  text: "text-indigo-800",  label: "In review" },
  FORWARDED:      { bg: "bg-purple-100",  text: "text-purple-800",  label: "With processor" },
  INFO_REQUESTED: { bg: "bg-amber-100",   text: "text-amber-900",   label: "Action needed" },
  APPROVED:       { bg: "bg-emerald-100", text: "text-emerald-800", label: "Approved" },
  REJECTED:       { bg: "bg-red-100",     text: "text-red-800",     label: "Rejected" },
};

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = use(params);
  const router = useRouter();

  const [app, setApp] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/supplier/gateway/applications/${applicationId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setApp(data.application);
        else {
          toast.error(data.error || "Application not found");
          router.replace("/supplier/payments");
        }
      })
      .catch(() => toast.error("Failed to load application"))
      .finally(() => setLoading(false));
  }, [applicationId, router]);

  if (loading) {
    return (
      <div className="p-6 lg:p-10 max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded w-1/3" />
          <div className="h-64 bg-gray-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!app) return null;

  const s = STATUS_STYLES[app.status];
  const money = (cents: number | null) =>
    cents == null
      ? "—"
      : `${app.currency} ${(cents / 100).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

  const addr = app.businessAddress || {};
  const addrLines = [
    addr.line1,
    addr.line2,
    [addr.city, addr.region, addr.postalCode].filter(Boolean).join(", "),
    addr.country,
  ].filter(Boolean);

  return (
    <div className="p-6 lg:p-10 max-w-3xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href="/supplier/payments" className="text-indigo-600 hover:underline">
            Payments
          </Link>
          <Icon icon="solar:alt-arrow-right-linear" className="w-3.5 h-3.5" />
          <span>Application</span>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">{app.legalName}</h1>
          <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${s.bg} ${s.text}`}>
            {s.label}
          </span>
        </div>
        <p className="text-gray-500 mt-1 text-sm">
          Submitted {new Date(app.submittedAt).toLocaleString()}
        </p>
      </div>

      {app.decryptError && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900 mb-6">
          {app.decryptError}
        </div>
      )}

      {/* Admin communication cards — surfaced at top so they're impossible to miss */}
      {app.status === "INFO_REQUESTED" && app.infoRequested && (
        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 mb-6">
          <p className="font-semibold text-amber-900 mb-1">Reviewer requested:</p>
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{app.infoRequested}</p>
        </div>
      )}
      {app.status === "REJECTED" && app.rejectionReason && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 mb-6">
          <p className="font-semibold text-red-900 mb-1">Rejected — reason:</p>
          <p className="text-sm text-red-900 whitespace-pre-wrap">{app.rejectionReason}</p>
        </div>
      )}
      {app.status === "APPROVED" && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 mb-6">
          <p className="font-semibold text-emerald-900 mb-1">Approved!</p>
          <p className="text-sm text-emerald-900">
            Your merchant account is live
            {app.processorReferenceId ? ` (MID ${app.processorReferenceId})` : ""}. New POs
            will include a payment link automatically.
          </p>
        </div>
      )}

      {/* Sections */}
      <Section title="Business information">
        <Row label="Legal name" value={app.legalName} />
        {app.dbaName && <Row label="DBA" value={app.dbaName} />}
        {app.businessTypeName && <Row label="Business type" value={app.businessTypeName} />}
        {app.incorporationDate && (
          <Row
            label="Incorporation date"
            value={new Date(app.incorporationDate).toLocaleDateString()}
          />
        )}
        {app.incorporationRegion && (
          <Row label="Incorporation region" value={app.incorporationRegion} />
        )}
        {app.mccCode && <Row label="MCC" value={app.mccCode} mono />}
        {app.websiteUrl && <Row label="Website" value={app.websiteUrl} />}
        {addrLines.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">
              Address
            </p>
            {addrLines.map((line, i) => (
              <p key={i} className="text-sm text-gray-800">
                {line}
              </p>
            ))}
          </div>
        )}
      </Section>

      <Section title="Volume & processor">
        {app.targetProcessor ? (
          <Row label="Preferred processor" value={app.targetProcessor} />
        ) : (
          <Row label="Preferred processor" value="No preference" />
        )}
        <Row
          label="Projected monthly volume"
          value={money(app.projectedMonthlyVolumeCents)}
        />
        <Row label="Average transaction" value={money(app.averageTicketCents)} />
      </Section>

      <Section title="Tax ID" sensitive>
        <Row
          label="Tax ID"
          value={app.taxIdMasked || <em className="text-gray-400 not-italic">Not provided</em>}
          mono
        />
      </Section>

      <Section title="Deposit bank account" sensitive>
        {app.bank ? (
          <>
            {app.bank.accountHolderName && (
              <Row label="Account holder" value={app.bank.accountHolderName} />
            )}
            {app.bank.bankName && <Row label="Bank" value={app.bank.bankName} />}
            {app.bank.routingNumberMasked && (
              <Row label="Routing" value={app.bank.routingNumberMasked} mono />
            )}
            {app.bank.accountNumberMasked && (
              <Row label="Account" value={app.bank.accountNumberMasked} mono />
            )}
          </>
        ) : (
          <p className="text-sm text-gray-400 italic">Not provided</p>
        )}
      </Section>

      <Section title={`Beneficial owners (${app.beneficialOwners.length})`} sensitive>
        {app.beneficialOwners.length === 0 ? (
          <p className="text-sm text-gray-400 italic">None listed</p>
        ) : (
          <div className="space-y-4">
            {app.beneficialOwners.map((o, i) => (
              <div key={i} className="p-3 rounded-xl border border-gray-100 bg-gray-50/50 space-y-1.5">
                <p className="font-semibold text-gray-900 text-sm">{o.name || "—"}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  {o.dob && (
                    <div>
                      <span className="text-gray-500">DOB:</span>{" "}
                      {new Date(o.dob).toLocaleDateString()}
                    </div>
                  )}
                  {o.ownershipPct != null && (
                    <div>
                      <span className="text-gray-500">Ownership:</span> {o.ownershipPct}%
                    </div>
                  )}
                  {o.idNumberMasked && (
                    <div className="font-mono">
                      <span className="text-gray-500 font-sans">ID:</span> {o.idNumberMasked}
                    </div>
                  )}
                  {o.address && (
                    <div className="col-span-2">
                      <span className="text-gray-500">Address:</span> {o.address}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Signer">
        {app.signerName && <Row label="Name" value={app.signerName} />}
        {app.signerTitle && <Row label="Title" value={app.signerTitle} />}
        {app.signerEmail && <Row label="Email" value={app.signerEmail} />}
        {app.signerConsentedAt && (
          <Row
            label="Consented"
            value={new Date(app.signerConsentedAt).toLocaleString()}
          />
        )}
      </Section>

      {(app.forwardedToEmail || app.adminNotes) && (
        <Section title="Reviewer">
          {app.forwardedToEmail && (
            <Row label="Forwarded to" value={app.forwardedToEmail} />
          )}
          {app.adminNotes && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">
                Notes
              </p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{app.adminNotes}</p>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function Section({
  title,
  sensitive,
  children,
}: {
  title: string;
  sensitive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-900">{title}</h2>
        {sensitive && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold uppercase tracking-wide inline-flex items-center gap-1">
            <Icon icon="solar:shield-check-bold" className="w-3 h-3" />
            Masked
          </span>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className={`text-gray-900 text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
