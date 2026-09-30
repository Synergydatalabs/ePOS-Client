"use client";

// Platform admin — application detail + action buttons.
//
// SENSITIVE — this page renders decrypted KYB data (tax ID, full bank
// account, ID numbers). Reveal each block on demand (hidden by default)
// so a shoulder-surf / screenshot doesn't leak everything at once.

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

interface Bank {
  accountHolderName?: string | null;
  routingNumber?: string | null;
  accountNumber?: string | null;
  bankName?: string | null;
}

interface Owner {
  name?: string;
  dob?: string | null;
  idNumber?: string | null;
  address?: string | null;
  ownershipPct?: number | null;
}

interface AppDetail {
  id: string;
  status: Status;
  targetProcessor: "GP" | "MONERIS" | "STRIPE" | null;
  supplier: {
    id: string;
    legalName: string;
    displayName: string;
    contactEmail: string | null;
    contactPhone: string | null;
  };
  legalName: string;
  dbaName: string | null;
  businessTypeName: string | null;
  incorporationDate: string | null;
  incorporationRegion: string | null;
  businessAddress: any;
  websiteUrl: string | null;
  mccCode: string | null;
  projectedMonthlyVolumeCents: number | null;
  averageTicketCents: number | null;
  currency: string;
  taxId: string | null;
  bank: Bank | null;
  beneficialOwners: Owner[];
  decryptError: string | null;
  signerName: string | null;
  signerTitle: string | null;
  signerEmail: string | null;
  signerConsentedAt: string | null;
  adminNotes: string | null;
  reviewedByAdminEmail: string | null;
  forwardedToEmail: string | null;
  processorReferenceId: string | null;
  rejectionReason: string | null;
  infoRequested: string | null;
  submittedAt: string;
  forwardedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  resultingProcessor: {
    id: string;
    processor: string;
    externalMid: string;
    status: string;
    activatedAt: string | null;
  } | null;
}

const STATUS_STYLES: Record<Status, { bg: string; text: string; label: string }> = {
  DRAFT:          { bg: "bg-gray-100",    text: "text-gray-700",    label: "Draft" },
  SUBMITTED:      { bg: "bg-blue-100",    text: "text-blue-800",    label: "New" },
  IN_REVIEW:      { bg: "bg-indigo-100",  text: "text-indigo-800",  label: "In review" },
  FORWARDED:      { bg: "bg-purple-100",  text: "text-purple-800",  label: "With processor" },
  INFO_REQUESTED: { bg: "bg-amber-100",   text: "text-amber-900",   label: "Info requested" },
  APPROVED:       { bg: "bg-emerald-100", text: "text-emerald-800", label: "Approved" },
  REJECTED:       { bg: "bg-red-100",     text: "text-red-800",     label: "Rejected" },
};

export default function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ appId: string }>;
}) {
  const { appId } = use(params);
  const router = useRouter();

  const [app, setApp] = useState<AppDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  // Reveal-on-demand for each sensitive block. Default hidden — reviewer
  // has to click to expose the values. Small friction, big security win.
  const [revealTaxId, setRevealTaxId] = useState(false);
  const [revealBank, setRevealBank] = useState(false);
  const [revealOwners, setRevealOwners] = useState(false);

  // Modal state per action — one open at a time
  const [openModal, setOpenModal] = useState<
    null | "requestInfo" | "forward" | "approve" | "reject"
  >(null);

  const load = () => {
    fetch(`/api/platform/gateway-applications/${appId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setApp(data.application);
        else {
          toast.error(data.error || "Application not found");
          router.replace("/platform/gateway-applications");
        }
      })
      .catch(() => toast.error("Failed to load application"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  const runAction = async (
    action: string,
    extra: Record<string, unknown> = {},
    successLabel: string
  ) => {
    setRunning(action);
    try {
      const res = await fetch(`/api/platform/gateway-applications/${appId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Action failed");
        return;
      }
      toast.success(successLabel);
      setOpenModal(null);
      load();
    } catch {
      toast.error("Action failed");
    } finally {
      setRunning(null);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
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

  const canAct =
    app.status !== "APPROVED" &&
    app.status !== "REJECTED" &&
    app.status !== "DRAFT";

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto pb-32">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href="/platform/gateway-applications" className="text-slate-700 hover:underline">
            Gateway Applications
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
          Supplier: <strong>{app.supplier.displayName}</strong>
          {" · "}Submitted {new Date(app.submittedAt).toLocaleString()}
        </p>
      </div>

      {/* Sensitive-data warning */}
      <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 mb-6 flex items-start gap-2">
        <Icon icon="solar:shield-warning-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>
          This page contains personally identifiable information + banking data.
          Do not screenshot, forward, or leave open in a shared workspace.
        </span>
      </div>

      {app.decryptError && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-900 mb-6">
          Decrypt error: {app.decryptError}
        </div>
      )}

      {/* Prior admin comms — surfaced at top */}
      {app.status === "INFO_REQUESTED" && app.infoRequested && (
        <SectionCard tint="amber" title="Info requested from supplier">
          <p className="text-sm text-amber-900 whitespace-pre-wrap">{app.infoRequested}</p>
        </SectionCard>
      )}
      {app.status === "APPROVED" && app.resultingProcessor && (
        <SectionCard tint="emerald" title="Approved — live processor">
          <div className="space-y-1 text-sm">
            <p><strong>Processor:</strong> {app.resultingProcessor.processor}</p>
            <p><strong>MID:</strong> <span className="font-mono">{app.resultingProcessor.externalMid}</span></p>
            <p><strong>Status:</strong> {app.resultingProcessor.status}</p>
            {app.resultingProcessor.activatedAt && (
              <p><strong>Activated:</strong> {new Date(app.resultingProcessor.activatedAt).toLocaleString()}</p>
            )}
          </div>
        </SectionCard>
      )}
      {app.status === "REJECTED" && app.rejectionReason && (
        <SectionCard tint="red" title="Rejected">
          <p className="text-sm text-red-900 whitespace-pre-wrap">{app.rejectionReason}</p>
        </SectionCard>
      )}

      {/* Business info */}
      <Section title="Business information">
        <Row label="Legal name" value={app.legalName} />
        {app.dbaName && <Row label="DBA" value={app.dbaName} />}
        {app.businessTypeName && <Row label="Business type" value={app.businessTypeName} />}
        {app.incorporationDate && (
          <Row label="Incorporation date" value={new Date(app.incorporationDate).toLocaleDateString()} />
        )}
        {app.incorporationRegion && <Row label="Region" value={app.incorporationRegion} />}
        {app.mccCode && <Row label="MCC" value={app.mccCode} mono />}
        {app.websiteUrl && <Row label="Website" value={app.websiteUrl} />}
        {addrLines.length > 0 && (
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Address</p>
            {addrLines.map((line, i) => (
              <p key={i} className="text-sm text-gray-800">{line}</p>
            ))}
          </div>
        )}
      </Section>

      <Section title="Volume + processor preference">
        <Row label="Preferred processor" value={app.targetProcessor || "None specified"} />
        <Row label="Projected monthly volume" value={money(app.projectedMonthlyVolumeCents)} />
        <Row label="Average ticket" value={money(app.averageTicketCents)} />
      </Section>

      {/* Sensitive: Tax ID */}
      <Section title="Tax ID" sensitive reveal={revealTaxId} onReveal={() => setRevealTaxId(true)}>
        {revealTaxId ? (
          <Row label="Tax ID" value={app.taxId || "Not provided"} mono />
        ) : (
          <p className="text-sm text-gray-400 italic">Hidden — click Reveal above</p>
        )}
      </Section>

      {/* Sensitive: Banking */}
      <Section title="Deposit bank account" sensitive reveal={revealBank} onReveal={() => setRevealBank(true)}>
        {!revealBank ? (
          <p className="text-sm text-gray-400 italic">Hidden — click Reveal above</p>
        ) : app.bank ? (
          <>
            {app.bank.accountHolderName && <Row label="Account holder" value={app.bank.accountHolderName} />}
            {app.bank.bankName && <Row label="Bank" value={app.bank.bankName} />}
            {app.bank.routingNumber && <Row label="Routing" value={app.bank.routingNumber} mono />}
            {app.bank.accountNumber && <Row label="Account" value={app.bank.accountNumber} mono />}
          </>
        ) : (
          <p className="text-sm text-gray-400 italic">Not provided</p>
        )}
      </Section>

      {/* Sensitive: Beneficial owners */}
      <Section
        title={`Beneficial owners (${app.beneficialOwners.length})`}
        sensitive
        reveal={revealOwners}
        onReveal={() => setRevealOwners(true)}
      >
        {!revealOwners ? (
          <p className="text-sm text-gray-400 italic">Hidden — click Reveal above</p>
        ) : app.beneficialOwners.length === 0 ? (
          <p className="text-sm text-gray-400 italic">None listed</p>
        ) : (
          <div className="space-y-3">
            {app.beneficialOwners.map((o, i) => (
              <div key={i} className="p-3 rounded-xl border border-gray-100 bg-gray-50/50 space-y-1">
                <p className="font-semibold text-gray-900 text-sm">{o.name || "—"}</p>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
                  {o.dob && <div><strong className="text-gray-700">DOB:</strong> {new Date(o.dob).toLocaleDateString()}</div>}
                  {o.ownershipPct != null && <div><strong className="text-gray-700">Owns:</strong> {o.ownershipPct}%</div>}
                  {o.idNumber && <div className="font-mono"><strong className="text-gray-700 font-sans">ID:</strong> {o.idNumber}</div>}
                  {o.address && <div className="col-span-2"><strong className="text-gray-700">Address:</strong> {o.address}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Signer */}
      <Section title="Signer">
        {app.signerName && <Row label="Name" value={app.signerName} />}
        {app.signerTitle && <Row label="Title" value={app.signerTitle} />}
        {app.signerEmail && <Row label="Email" value={app.signerEmail} />}
        {app.signerConsentedAt && (
          <Row label="Consented" value={new Date(app.signerConsentedAt).toLocaleString()} />
        )}
      </Section>

      {/* Reviewer audit */}
      {(app.reviewedByAdminEmail || app.forwardedToEmail || app.adminNotes) && (
        <Section title="Reviewer audit">
          {app.reviewedByAdminEmail && <Row label="Last reviewed by" value={app.reviewedByAdminEmail} />}
          {app.forwardedToEmail && <Row label="Forwarded to" value={app.forwardedToEmail} />}
          {app.processorReferenceId && <Row label="Processor reference" value={app.processorReferenceId} mono />}
          {app.adminNotes && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Notes</p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{app.adminNotes}</p>
            </div>
          )}
        </Section>
      )}

      {/* Sticky action bar */}
      {canAct && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 z-30">
          <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {app.status === "SUBMITTED" && (
                <button
                  onClick={() => runAction("markInReview", {}, "Marked as in review")}
                  disabled={!!running}
                  className="px-3 py-2 rounded-lg text-sm font-medium text-slate-700 border border-gray-200 hover:bg-gray-50"
                >
                  Mark In Review
                </button>
              )}
              <button
                onClick={() => setOpenModal("requestInfo")}
                disabled={!!running}
                className="px-3 py-2 rounded-lg text-sm font-medium text-amber-800 border border-amber-200 bg-amber-50 hover:bg-amber-100"
              >
                Request Info
              </button>
              <button
                onClick={() => setOpenModal("reject")}
                disabled={!!running}
                className="px-3 py-2 rounded-lg text-sm font-medium text-red-700 border border-red-200 bg-red-50 hover:bg-red-100"
              >
                Reject
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOpenModal("forward")}
                disabled={!!running}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-purple-600 hover:bg-purple-700"
              >
                Forward to Processor
              </button>
              <button
                onClick={() => setOpenModal("approve")}
                disabled={!!running}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700"
              >
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <RequestInfoModal
        open={openModal === "requestInfo"}
        onClose={() => setOpenModal(null)}
        onSubmit={(infoRequested) =>
          runAction("requestInfo", { infoRequested }, "Info requested — supplier notified")
        }
        running={running === "requestInfo"}
      />
      <ForwardModal
        open={openModal === "forward"}
        onClose={() => setOpenModal(null)}
        defaultProcessor={app.targetProcessor}
        onSubmit={(processor, processorEmail) =>
          runAction("forwardToProcessor", { processor, processorEmail }, "Forwarded to processor")
        }
        running={running === "forwardToProcessor"}
      />
      <ApproveModal
        open={openModal === "approve"}
        onClose={() => setOpenModal(null)}
        defaultProcessor={app.targetProcessor}
        onSubmit={(processor, externalMid, credentials, feeSchedule) =>
          runAction(
            "approve",
            { processor, externalMid, credentials, feeSchedule },
            "Approved — supplier notified and gateway activated"
          )
        }
        running={running === "approve"}
      />
      <RejectModal
        open={openModal === "reject"}
        onClose={() => setOpenModal(null)}
        onSubmit={(rejectionReason) =>
          runAction("reject", { rejectionReason }, "Rejected — supplier notified")
        }
        running={running === "reject"}
      />
    </div>
  );
}

// ---------- small local components ----------

function Section({
  title,
  sensitive,
  reveal,
  onReveal,
  children,
}: {
  title: string;
  sensitive?: boolean;
  reveal?: boolean;
  onReveal?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-bold text-gray-900">{title}</h2>
        {sensitive && !reveal && (
          <button
            onClick={onReveal}
            className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 font-semibold hover:bg-amber-200 inline-flex items-center gap-1"
          >
            <Icon icon="solar:eye-linear" className="w-3.5 h-3.5" />
            Reveal
          </button>
        )}
        {sensitive && reveal && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-semibold inline-flex items-center gap-1">
            <Icon icon="solar:eye-scan-bold" className="w-3 h-3" />
            Revealed
          </span>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SectionCard({
  tint,
  title,
  children,
}: {
  tint: "amber" | "emerald" | "red";
  title: string;
  children: React.ReactNode;
}) {
  const bg = { amber: "bg-amber-50", emerald: "bg-emerald-50", red: "bg-red-50" }[tint];
  const border = {
    amber: "border-amber-200",
    emerald: "border-emerald-200",
    red: "border-red-200",
  }[tint];
  const text = {
    amber: "text-amber-900",
    emerald: "text-emerald-900",
    red: "text-red-900",
  }[tint];
  return (
    <div className={`p-4 rounded-2xl border mb-4 ${bg} ${border}`}>
      <p className={`font-semibold mb-2 ${text}`}>{title}</p>
      <div className={text}>{children}</div>
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

// ---------- action modals ----------

function ModalShell({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <Icon icon="solar:close-circle-linear" className="w-6 h-6" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RequestInfoModal({
  open,
  onClose,
  onSubmit,
  running,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (info: string) => void;
  running: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <ModalShell open={open} onClose={onClose} title="Request Info from Supplier">
      <p className="text-sm text-gray-600 mb-3">
        The supplier receives an email with this message and the application flips
        to <strong>Info Requested</strong>.
      </p>
      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Please upload a void cheque, and confirm the DBA name matches your incorporation."
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
      />
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button
          onClick={() => onSubmit(text)}
          disabled={running || !text.trim()}
          className="px-4 py-2 rounded-lg bg-amber-500 text-white font-semibold hover:bg-amber-600 disabled:opacity-60"
        >
          {running ? "Sending…" : "Send Request"}
        </button>
      </div>
    </ModalShell>
  );
}

function ForwardModal({
  open,
  onClose,
  defaultProcessor,
  onSubmit,
  running,
}: {
  open: boolean;
  onClose: () => void;
  defaultProcessor: "GP" | "MONERIS" | "STRIPE" | null;
  onSubmit: (processor: string, processorEmail: string) => void;
  running: boolean;
}) {
  const [processor, setProcessor] = useState<string>(defaultProcessor || "GP");
  const [email, setEmail] = useState("");
  return (
    <ModalShell open={open} onClose={onClose} title="Forward to Processor">
      <p className="text-sm text-gray-600 mb-3">
        Sends a merchant referral email to the processor's onboarding team.
        Does NOT include PII / KYB data — those go through the processor's
        secure channel.
      </p>
      <label className="block text-sm font-medium text-gray-700 mb-1.5 mt-3">Processor</label>
      <select
        value={processor}
        onChange={(e) => setProcessor(e.target.value)}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      >
        <option value="GP">Global Payments (GP)</option>
        <option value="MONERIS">Moneris</option>
        <option value="STRIPE">Stripe</option>
      </select>
      <label className="block text-sm font-medium text-gray-700 mb-1.5 mt-4">
        Processor onboarding email
      </label>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="onboarding@globalpay.com"
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
      />
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button
          onClick={() => onSubmit(processor, email)}
          disabled={running || !email.trim()}
          className="px-4 py-2 rounded-lg bg-purple-600 text-white font-semibold hover:bg-purple-700 disabled:opacity-60"
        >
          {running ? "Sending…" : "Send Lead"}
        </button>
      </div>
    </ModalShell>
  );
}

function ApproveModal({
  open,
  onClose,
  defaultProcessor,
  onSubmit,
  running,
}: {
  open: boolean;
  onClose: () => void;
  defaultProcessor: "GP" | "MONERIS" | "STRIPE" | null;
  onSubmit: (processor: string, mid: string, credentials: any, feeSchedule: any) => void;
  running: boolean;
}) {
  const [processor, setProcessor] = useState<string>(defaultProcessor || "GP");
  const [mid, setMid] = useState("");
  const [credsJson, setCredsJson] = useState(`{
  "app_id": "",
  "app_key": ""
}`);
  const [feePercent, setFeePercent] = useState("");
  const [feeFixed, setFeeFixed] = useState("");

  const submit = () => {
    let credentials: any;
    try {
      credentials = JSON.parse(credsJson);
    } catch {
      toast.error("Credentials must be valid JSON");
      return;
    }
    if (!mid.trim()) {
      toast.error("MID is required");
      return;
    }
    const feeSchedule: any = {};
    const pct = parseFloat(feePercent);
    if (Number.isFinite(pct) && pct >= 0) feeSchedule.percentBps = Math.round(pct * 100);
    const fixed = parseFloat(feeFixed);
    if (Number.isFinite(fixed) && fixed >= 0) feeSchedule.fixedCents = Math.round(fixed * 100);
    onSubmit(
      processor,
      mid.trim(),
      credentials,
      Object.keys(feeSchedule).length ? feeSchedule : null
    );
  };

  return (
    <ModalShell open={open} onClose={onClose} title="Approve & Activate">
      <p className="text-sm text-gray-600 mb-3">
        Approve the application and enter the processor's response. Credentials
        are encrypted before storage. Supplier gets an activation email.
      </p>
      <label className="block text-sm font-medium text-gray-700 mb-1.5 mt-2">Processor</label>
      <select
        value={processor}
        onChange={(e) => setProcessor(e.target.value)}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
      >
        <option value="GP">Global Payments (GP)</option>
        <option value="MONERIS">Moneris</option>
        <option value="STRIPE">Stripe</option>
      </select>

      <label className="block text-sm font-medium text-gray-700 mb-1.5 mt-4">
        Merchant ID (MID)
      </label>
      <input
        type="text"
        value={mid}
        onChange={(e) => setMid(e.target.value)}
        placeholder="Assigned by processor"
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono"
      />

      <label className="block text-sm font-medium text-gray-700 mb-1.5 mt-4">
        Credentials (JSON) — encrypted at rest
      </label>
      <textarea
        rows={6}
        value={credsJson}
        onChange={(e) => setCredsJson(e.target.value)}
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-xs"
      />
      <p className="text-[11px] text-gray-500 mt-1">
        Shape varies by processor — GP: {`{app_id, app_key}`}, Moneris: {`{store_id, api_token}`},
        Stripe: {`{access_token, stripe_user_id}`}
      </p>

      <div className="grid grid-cols-2 gap-3 mt-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Fee % (optional)</label>
          <input
            type="number"
            step="0.01"
            value={feePercent}
            onChange={(e) => setFeePercent(e.target.value)}
            placeholder="e.g. 2.5"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Fee fixed $</label>
          <input
            type="number"
            step="0.01"
            value={feeFixed}
            onChange={(e) => setFeeFixed(e.target.value)}
            placeholder="e.g. 0.30"
            className="w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={running}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-60"
        >
          {running ? "Approving…" : "Approve & Activate"}
        </button>
      </div>
    </ModalShell>
  );
}

function RejectModal({
  open,
  onClose,
  onSubmit,
  running,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  running: boolean;
}) {
  const [reason, setReason] = useState("");
  return (
    <ModalShell open={open} onClose={onClose} title="Reject Application">
      <p className="text-sm text-gray-600 mb-3">
        The supplier receives a rejection email with this reason. They can
        submit a fresh application afterwards.
      </p>
      <textarea
        rows={4}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Beneficial owner information incomplete after two rounds of clarification."
        className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent outline-none"
      />
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
          Cancel
        </button>
        <button
          onClick={() => onSubmit(reason)}
          disabled={running || !reason.trim()}
          className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-60"
        >
          {running ? "Rejecting…" : "Confirm Rejection"}
        </button>
      </div>
    </ModalShell>
  );
}
