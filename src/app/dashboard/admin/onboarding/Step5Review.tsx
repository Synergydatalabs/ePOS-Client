// Step 5 — Read-only review + typed e-signature block + SLA callout.
// Submit button is disabled until signer name, title, email, and consent
// are all populated. Server re-validates that every wizard-required
// field is set before accepting the transition.

"use client";

import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { Button, Input } from "@/components/ui";
import type { WizardApplication } from "./types";

interface Props {
  application: WizardApplication | null;
  tenantId: string;
  readOnly: boolean;
  onEditStep: (stepIndex: number) => void;
  onSubmitted: () => Promise<void>;
}

export default function Step5Review({
  application,
  tenantId,
  readOnly,
  onEditStep,
  onSubmitted,
}: Props) {
  const [signerName, setSignerName] = useState(application?.signerName || "");
  const [signerTitle, setSignerTitle] = useState(application?.signerTitle || "");
  const [signerEmail, setSignerEmail] = useState(application?.signerEmail || "");
  const [consented, setConsented] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [missing, setMissing] = useState<string[] | null>(null);

  const legalName = application?.legalName || "your business";

  const canSubmit = useMemo(() => {
    if (readOnly) return false;
    if (!signerName.trim()) return false;
    if (!signerTitle.trim()) return false;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail.trim())) return false;
    if (!consented) return false;
    return true;
  }, [readOnly, signerName, signerTitle, signerEmail, consented]);

  const handleSubmit = async () => {
    if (!application) return;
    setSubmitting(true);
    setMissing(null);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/onboarding/application/submit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            signerName: signerName.trim(),
            signerTitle: signerTitle.trim(),
            signerEmail: signerEmail.trim().toLowerCase(),
            consented: true,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.missing)) setMissing(data.missing);
        throw new Error(data.error || `Submit failed (${res.status})`);
      }
      toast.success("Application submitted!");
      await onSubmitted();
    } catch (e) {
      toast.error((e as Error).message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (!application) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">
        Complete Step 1 first — nothing to review yet.
      </div>
    );
  }

  const addr = (application.businessAddress || {}) as Record<string, string>;
  const money = (cents: number | null) =>
    cents == null
      ? "—"
      : `${application.currency} ${(cents / 100).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Review & sign</h2>
        <p className="text-sm text-gray-500">
          Once submitted, the record locks and moves to our review queue.
        </p>
      </div>

      {/* SLA callout */}
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
        <div className="flex items-start gap-3">
          <Icon icon="solar:calendar-mark-bold" className="w-5 h-5 text-indigo-700 mt-0.5" />
          <div className="text-sm text-indigo-900">
            <p className="font-semibold">Expected approval times</p>
            <ul className="mt-1 list-disc list-inside space-y-0.5">
              <li>
                <strong>Global Payments:</strong> typically 3-5 business days
              </li>
              <li>
                <strong>Moneris:</strong> typically 5-10 business days
              </li>
            </ul>
            <p className="mt-2 text-indigo-800/90">
              We'll email <strong>{signerEmail || "the signer"}</strong> when a decision comes back.
            </p>
          </div>
        </div>
      </div>

      {application.status === "SUBMITTED" && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold flex items-center gap-2">
            <Icon icon="solar:check-circle-bold" className="w-5 h-5" />
            Submitted successfully.
          </p>
          <p className="mt-1">
            Submitted on{" "}
            {application.submittedAt
              ? new Date(application.submittedAt).toLocaleString()
              : "—"}
            . Our compliance team is reviewing your application.
          </p>
        </div>
      )}

      {/* Summary sections */}
      <SummarySection
        title="Business"
        onEdit={() => onEditStep(0)}
        rows={[
          ["Legal name", application.legalName],
          ["DBA", application.dbaName || "—"],
          ["Structure", application.businessTypeName || "—"],
          ["Incorporation", application.incorporationDate ? new Date(application.incorporationDate).toLocaleDateString() : "—"],
          ["Jurisdiction", application.incorporationRegion || "—"],
          ["MCC", application.mccCode || "—"],
          ["Website", application.websiteUrl || "—"],
          [
            "Address",
            [addr.line1, addr.line2, addr.city, addr.province, addr.postalCode, addr.country]
              .filter(Boolean)
              .join(", ") || "—",
          ],
        ]}
      />

      <SummarySection
        title="Financials"
        onEdit={() => onEditStep(1)}
        rows={[
          ["Projected monthly volume", money(application.projectedMonthlyVolumeCents)],
          ["Average ticket", money(application.averageTicketCents)],
          ["Settlement currency", application.currency],
          ["Tax ID", application.hasTaxId ? "•••• saved (encrypted)" : "Not provided"],
          ["Bank account", application.hasBankInfo ? "•••• saved (encrypted)" : "Not provided"],
        ]}
      />

      <SummarySection
        title={`Owners (${application.ubos.length})`}
        onEdit={() => onEditStep(2)}
        rows={application.ubos.length === 0
          ? [["", "No UBOs added yet."]]
          : application.ubos.map((u) => [
              u.fullName,
              `${Number(u.ownershipPct).toFixed(2)}% · ${u.idType} · ${u.hasIdNumber ? "ID on file" : "ID missing"}`,
            ])}
      />

      <SummarySection
        title={`Documents (${application.documents.length})`}
        onEdit={() => onEditStep(3)}
        rows={application.documents.length === 0
          ? [["", "No documents uploaded yet."]]
          : application.documents.slice(0, 12).map((d) => [
              d.docType.replaceAll("_", " ").toLowerCase(),
              `${d.originalFilename} · ${(d.sizeBytes / 1024).toFixed(0)} KB`,
            ])}
      />

      {/* Signer block */}
      {application.status !== "SUBMITTED" && application.status !== "IN_REVIEW" && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">Signer</p>
            <p className="text-xs text-gray-500">
              Enter your details as an authorised signatory of {legalName}.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              label="Full name *"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              disabled={readOnly}
            />
            <Input
              label="Title *"
              value={signerTitle}
              onChange={(e) => setSignerTitle(e.target.value)}
              disabled={readOnly}
              placeholder="Director / CFO / Owner"
            />
            <Input
              label="Email *"
              type="email"
              value={signerEmail}
              onChange={(e) => setSignerEmail(e.target.value)}
              disabled={readOnly}
            />
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 cursor-pointer">
            <input
              type="checkbox"
              className="mt-1"
              checked={consented}
              disabled={readOnly}
              onChange={(e) => setConsented(e.target.checked)}
            />
            <span className="text-xs text-gray-700">
              I confirm the information above is accurate to the best of my knowledge and that I am
              authorised to submit this application on behalf of <strong>{legalName}</strong>. I
              understand this typed signature has the same legal effect as a handwritten one and I
              authorise iTap to share this application with our chosen payment processor.
            </span>
          </label>

          {missing && missing.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
              <p className="font-semibold mb-1">Please complete these before submitting:</p>
              <ul className="list-disc list-inside space-y-0.5">
                {missing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <Button
              variant="primary"
              onClick={handleSubmit}
              loading={submitting}
              disabled={!canSubmit || submitting}
            >
              Submit application
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummarySection({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: Array<[string, string]>;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-medium text-indigo-700 hover:underline"
        >
          Edit
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {rows.map(([label, value], i) => (
          <div key={i} className="flex justify-between gap-3 border-b border-dashed border-gray-100 pb-1">
            <span className="text-gray-500 truncate">{label}</span>
            <span className="text-gray-900 text-right truncate max-w-[60%]" title={value}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
