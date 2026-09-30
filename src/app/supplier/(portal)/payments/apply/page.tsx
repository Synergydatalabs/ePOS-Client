"use client";

// /supplier/payments/apply — the KYB form.
//
// Single-page long-form with clearly-titled sections. Sticky "Submit"
// button at the bottom. Sensitive fields (tax id, bank, id numbers) are
// sent as plaintext over HTTPS and encrypted server-side.
//
// After submit the supplier lands on the status page which will show the
// application as "Submitted".

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Owner {
  name: string;
  dob: string;
  idNumber: string;
  address: string;
  ownershipPct: string;
}

const emptyOwner = (): Owner => ({
  name: "",
  dob: "",
  idNumber: "",
  address: "",
  ownershipPct: "",
});

export default function GatewayApplicationPage() {
  const router = useRouter();

  // Business info
  const [legalName, setLegalName] = useState("");
  const [dbaName, setDbaName] = useState("");
  const [businessTypeName, setBusinessTypeName] = useState("");
  const [incorporationDate, setIncorporationDate] = useState("");
  const [incorporationRegion, setIncorporationRegion] = useState("");
  const [businessAddress, setBusinessAddress] = useState({
    line1: "",
    line2: "",
    city: "",
    region: "",
    postalCode: "",
    country: "CA",
  });
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [mccCode, setMccCode] = useState("");

  // Financial projections
  const [projectedMonthlyVolume, setProjectedMonthlyVolume] = useState("");
  const [averageTicket, setAverageTicket] = useState("");
  const [targetProcessor, setTargetProcessor] = useState<"" | "GP" | "MONERIS" | "STRIPE">("");

  // Sensitive
  const [taxId, setTaxId] = useState("");
  const [bankAccountHolderName, setBankAccountHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  // Beneficial owners — dynamic list
  const [owners, setOwners] = useState<Owner[]>([emptyOwner()]);

  // Signer
  const [signerName, setSignerName] = useState("");
  const [signerTitle, setSignerTitle] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signerConsented, setSignerConsented] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  const addOwner = () => setOwners([...owners, emptyOwner()]);
  const removeOwner = (i: number) =>
    setOwners(owners.length > 1 ? owners.filter((_, idx) => idx !== i) : owners);
  const updateOwner = (i: number, patch: Partial<Owner>) =>
    setOwners(owners.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  const handleSubmit = async () => {
    // Client-side sanity — server does the authoritative validation, but
    // catching obvious misses here saves a round-trip.
    if (!legalName.trim()) return toast.error("Legal business name is required");
    if (!signerName.trim()) return toast.error("Signer name is required");
    if (!signerEmail.trim()) return toast.error("Signer email is required");
    if (!signerConsented) return toast.error("Please tick the consent checkbox");

    setSubmitting(true);
    try {
      const res = await fetch("/api/supplier/gateway/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legalName: legalName.trim(),
          dbaName: dbaName.trim() || undefined,
          businessTypeName: businessTypeName.trim() || undefined,
          incorporationDate: incorporationDate || undefined,
          incorporationRegion: incorporationRegion.trim() || undefined,
          businessAddress: hasAnyAddress(businessAddress) ? businessAddress : undefined,
          websiteUrl: websiteUrl.trim() || undefined,
          mccCode: mccCode.trim() || undefined,

          projectedMonthlyVolume: projectedMonthlyVolume
            ? parseFloat(projectedMonthlyVolume)
            : undefined,
          averageTicket: averageTicket ? parseFloat(averageTicket) : undefined,
          targetProcessor: targetProcessor || undefined,

          taxId: taxId.trim() || undefined,
          bankInfo: {
            accountHolderName: bankAccountHolderName.trim() || undefined,
            bankName: bankName.trim() || undefined,
            routingNumber: routingNumber.trim() || undefined,
            accountNumber: accountNumber.trim() || undefined,
          },
          beneficialOwners: owners
            .filter((o) => o.name.trim())
            .map((o) => ({
              name: o.name.trim(),
              dob: o.dob || undefined,
              idNumber: o.idNumber.trim() || undefined,
              address: o.address.trim() || undefined,
              ownershipPct: o.ownershipPct ? parseFloat(o.ownershipPct) : undefined,
            })),

          signerName: signerName.trim(),
          signerTitle: signerTitle.trim() || undefined,
          signerEmail: signerEmail.trim(),
          signerConsented: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Submission failed");
        setSubmitting(false);
        return;
      }
      toast.success("Application submitted! Our team will review it shortly.");
      router.push("/supplier/payments");
    } catch {
      toast.error("Submission failed");
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 lg:p-10 max-w-3xl mx-auto pb-32">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-2">
          <Link href="/supplier/payments" className="text-indigo-600 hover:underline">
            Payments
          </Link>
          <Icon icon="solar:alt-arrow-right-linear" className="w-3.5 h-3.5" />
          <span>Apply</span>
        </div>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
          Payment Gateway Application
        </h1>
        <p className="text-gray-500 mt-1">
          Fill out the sections below. Sensitive fields are encrypted before storage.
        </p>
      </div>

      {/* Business info */}
      <Section
        title="Business information"
        subtitle="Details about your legal business entity."
      >
        <TextField label="Legal business name" required value={legalName} onChange={setLegalName} />
        <TextField label="Doing-business-as (DBA)" value={dbaName} onChange={setDbaName} hint="If different from legal name" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField
            label="Business type"
            value={businessTypeName}
            onChange={setBusinessTypeName}
            placeholder="LLC, Corp, Sole Prop, Partnership"
          />
          <TextField
            label="MCC code"
            value={mccCode}
            onChange={setMccCode}
            placeholder="e.g. 5411"
            hint="Merchant Category Code (leave blank if unsure)"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Date of incorporation
            </label>
            <input
              type="date"
              value={incorporationDate}
              onChange={(e) => setIncorporationDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <TextField
            label="Region of incorporation"
            value={incorporationRegion}
            onChange={setIncorporationRegion}
            placeholder="e.g. Ontario, Delaware"
          />
        </div>
        <TextField
          label="Website"
          type="url"
          value={websiteUrl}
          onChange={setWebsiteUrl}
          placeholder="https://…"
        />

        <div className="mt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Business address
          </p>
          <div className="space-y-3">
            <TextField
              label="Address line 1"
              value={businessAddress.line1}
              onChange={(v) => setBusinessAddress({ ...businessAddress, line1: v })}
            />
            <TextField
              label="Address line 2"
              value={businessAddress.line2}
              onChange={(v) => setBusinessAddress({ ...businessAddress, line2: v })}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <TextField
                label="City"
                value={businessAddress.city}
                onChange={(v) => setBusinessAddress({ ...businessAddress, city: v })}
              />
              <TextField
                label="Region / State"
                value={businessAddress.region}
                onChange={(v) => setBusinessAddress({ ...businessAddress, region: v })}
              />
              <TextField
                label="Postal / ZIP"
                value={businessAddress.postalCode}
                onChange={(v) => setBusinessAddress({ ...businessAddress, postalCode: v })}
              />
            </div>
            <TextField
              label="Country"
              value={businessAddress.country}
              onChange={(v) => setBusinessAddress({ ...businessAddress, country: v })}
              placeholder="CA / US"
            />
          </div>
        </div>
      </Section>

      {/* Financial */}
      <Section
        title="Volume & processor preference"
        subtitle="Rough estimates help processors underwrite the application."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField
            label="Projected monthly card volume"
            type="number"
            value={projectedMonthlyVolume}
            onChange={setProjectedMonthlyVolume}
            placeholder="e.g. 25000"
            hint="Dollars per month (estimate is fine)"
          />
          <TextField
            label="Average transaction"
            type="number"
            value={averageTicket}
            onChange={setAverageTicket}
            placeholder="e.g. 350"
            hint="Dollars per typical order"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Preferred processor
          </label>
          <select
            value={targetProcessor}
            onChange={(e) => setTargetProcessor(e.target.value as any)}
            className={inputClass}
          >
            <option value="">No preference — we'll pick the best fit</option>
            <option value="GP">Global Payments (GP)</option>
            <option value="MONERIS">Moneris</option>
            <option value="STRIPE">Stripe</option>
          </select>
        </div>
      </Section>

      {/* Tax ID (sensitive) */}
      <Section
        title="Tax identification"
        subtitle="Encrypted at rest — only visible to our review team."
        sensitive
      >
        <TextField
          label="Business tax ID (EIN / BN)"
          value={taxId}
          onChange={setTaxId}
          placeholder="9 digits (US) or 9-digit BN (Canada)"
        />
      </Section>

      {/* Banking (sensitive) */}
      <Section
        title="Deposit bank account"
        subtitle="Where processor deposits will land. Encrypted at rest."
        sensitive
      >
        <TextField
          label="Account holder name"
          value={bankAccountHolderName}
          onChange={setBankAccountHolderName}
          hint="Must match legal business name"
        />
        <TextField label="Bank name" value={bankName} onChange={setBankName} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField
            label="Routing / transit number"
            value={routingNumber}
            onChange={setRoutingNumber}
            placeholder="9 digits (US) or 5+3 transit-institution (CA)"
          />
          <TextField
            label="Account number"
            value={accountNumber}
            onChange={setAccountNumber}
          />
        </div>
      </Section>

      {/* Beneficial owners (sensitive) */}
      <Section
        title="Beneficial owners"
        subtitle="Anyone owning 25% or more of the business. Add all that apply. Encrypted at rest."
        sensitive
      >
        <div className="space-y-4">
          {owners.map((o, i) => (
            <div key={i} className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Owner {i + 1}</p>
                {owners.length > 1 && (
                  <button
                    onClick={() => removeOwner(i)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField
                  label="Full name"
                  value={o.name}
                  onChange={(v) => updateOwner(i, { name: v })}
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Date of birth
                  </label>
                  <input
                    type="date"
                    value={o.dob}
                    onChange={(e) => updateOwner(i, { dob: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <TextField
                  label="ID number (SSN / SIN)"
                  value={o.idNumber}
                  onChange={(v) => updateOwner(i, { idNumber: v })}
                />
                <TextField
                  label="Ownership %"
                  type="number"
                  value={o.ownershipPct}
                  onChange={(v) => updateOwner(i, { ownershipPct: v })}
                  placeholder="e.g. 50"
                />
              </div>
              <TextField
                label="Address"
                value={o.address}
                onChange={(v) => updateOwner(i, { address: v })}
              />
            </div>
          ))}
          <button
            onClick={addOwner}
            className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline"
          >
            <Icon icon="solar:add-circle-linear" className="w-4 h-4" />
            Add another owner
          </button>
        </div>
      </Section>

      {/* Signer */}
      <Section
        title="Signer"
        subtitle="Person with authority to open the merchant account."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField label="Full name" required value={signerName} onChange={setSignerName} />
          <TextField
            label="Title"
            value={signerTitle}
            onChange={setSignerTitle}
            placeholder="e.g. CEO, Director, Owner"
          />
        </div>
        <TextField
          label="Email"
          type="email"
          required
          value={signerEmail}
          onChange={setSignerEmail}
        />

        <label className="mt-4 flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={signerConsented}
            onChange={(e) => setSignerConsented(e.target.checked)}
            className="mt-1 rounded"
          />
          <span>
            I confirm the information above is accurate and I have authority to submit this
            application on behalf of the business. I authorize {`{iTap}`} to forward this data
            to the selected payment processor for underwriting review.
          </span>
        </label>
      </Section>

      {/* Sticky submit bar */}
      <div className="fixed bottom-0 left-0 lg:left-64 right-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between gap-3 z-30">
        <p className="text-xs text-gray-500 hidden sm:block">
          Review your entries — sensitive fields become masked after submit.
        </p>
        <div className="flex gap-3 ml-auto">
          <Link
            href="/supplier/payments"
            className="px-5 py-2.5 rounded-xl text-gray-600 border border-gray-200 hover:bg-gray-50 font-medium"
          >
            Cancel
          </Link>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-60"
          >
            <Icon icon="solar:paper-plane-bold" className="w-4 h-4" />
            {submitting ? "Submitting…" : "Submit Application"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Local helpers ----------

const inputClass =
  "w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none";

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  subtitle,
  sensitive,
  children,
}: {
  title: string;
  subtitle?: string;
  sensitive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 lg:p-6 mb-6">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {sensitive && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-semibold uppercase tracking-wide inline-flex items-center gap-1">
            <Icon icon="solar:shield-check-bold" className="w-3 h-3" />
            Encrypted
          </span>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function hasAnyAddress(addr: {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}): boolean {
  return !!(addr.line1 || addr.city || addr.region || addr.postalCode);
}
