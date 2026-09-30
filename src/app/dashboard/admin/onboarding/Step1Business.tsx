// Step 1 — legal entity, DBA, contact, incorporation, address, MCC.
// Everything here is plaintext in the DB; encryption doesn't kick in
// until Step 2 (tax id + bank).

"use client";

import { useEffect, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import type { BusinessAddress, FinancialsExtras, WizardApplication } from "./types";

interface Props {
  application: WizardApplication | null;
  readOnly: boolean;
  saving: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onNext: () => void;
}

// Small curated MCC list — most common brick-and-mortar POS categories.
// The dropdown lets a merchant search / type-ahead; free-form entry is
// deliberately NOT allowed to prevent typos on a critical processor field.
const COMMON_MCCS: Array<{ value: string; label: string }> = [
  { value: "5812", label: "5812 · Eating places, restaurants" },
  { value: "5813", label: "5813 · Bars, cocktail lounges, nightclubs" },
  { value: "5814", label: "5814 · Fast food restaurants" },
  { value: "5411", label: "5411 · Grocery stores, supermarkets" },
  { value: "5499", label: "5499 · Misc food stores (convenience, etc.)" },
  { value: "5399", label: "5399 · Misc general merchandise" },
  { value: "5651", label: "5651 · Family clothing stores" },
  { value: "5699", label: "5699 · Misc apparel & accessory stores" },
  { value: "5977", label: "5977 · Cosmetic stores" },
  { value: "7230", label: "7230 · Beauty & barber shops" },
  { value: "7298", label: "7298 · Health & beauty spas" },
  { value: "4121", label: "4121 · Taxicabs, limousines" },
  { value: "5541", label: "5541 · Service stations (gas)" },
  { value: "5912", label: "5912 · Drug stores, pharmacies" },
  { value: "8398", label: "8398 · Charitable organisations" },
  { value: "5999", label: "5999 · Miscellaneous & specialty retail" },
];

// Small ISO-3 country list — most tenants are CA/US. Extend as needed.
const COUNTRIES: Array<{ value: string; label: string }> = [
  { value: "CAN", label: "Canada" },
  { value: "USA", label: "United States" },
  { value: "GBR", label: "United Kingdom" },
  { value: "AUS", label: "Australia" },
  { value: "MEX", label: "Mexico" },
  { value: "IRL", label: "Ireland" },
  { value: "NZL", label: "New Zealand" },
];

const BUSINESS_TYPES: Array<{ value: string; label: string }> = [
  { value: "LLC", label: "LLC" },
  { value: "Corp", label: "Corporation" },
  { value: "SoleProp", label: "Sole Proprietorship" },
  { value: "Partnership", label: "Partnership" },
  { value: "NonProfit", label: "Non-profit" },
  { value: "Other", label: "Other" },
];

export default function Step1Business({
  application,
  readOnly,
  saving,
  onSave,
  onNext,
}: Props) {
  // Local mirror — form is edited in place, then flushed to the server on
  // "Save & Continue". We deliberately don't debounce-save every keystroke;
  // KYB fields deserve an explicit commit.
  const [legalName, setLegalName] = useState("");
  const [dbaName, setDbaName] = useState("");
  const [businessTypeName, setBusinessTypeName] = useState("");
  const [businessPhone, setBusinessPhone] = useState("");
  const [businessEmail, setBusinessEmail] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [incorporationDate, setIncorporationDate] = useState("");
  const [incorporationRegion, setIncorporationRegion] = useState("");
  const [industryDescription, setIndustryDescription] = useState("");
  const [mccCode, setMccCode] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("CAN");

  const [error, setError] = useState<string | null>(null);

  // Hydrate from server on mount / reload.
  useEffect(() => {
    if (!application) {
      // Fresh — pre-fill sensible defaults, wipe legacy placeholder.
      setLegalName("");
      return;
    }
    setLegalName(
      application.legalName?.startsWith("(draft") ? "" : application.legalName || ""
    );
    setDbaName(application.dbaName || "");
    setBusinessTypeName(application.businessTypeName || "");
    setWebsiteUrl(application.websiteUrl || "");
    setIncorporationDate(
      application.incorporationDate
        ? new Date(application.incorporationDate).toISOString().slice(0, 10)
        : ""
    );
    setIncorporationRegion(application.incorporationRegion || "");
    setMccCode(application.mccCode || "");

    // businessAddress is a JSON blob — we co-locate phone/email/industry
    // in there so we don't touch schema.prisma this phase.
    const addr = application.businessAddress as (BusinessAddress & {
      phone?: string;
      email?: string;
      industryDescription?: string;
    } & FinancialsExtras) | null;
    setLine1(addr?.line1 || "");
    setLine2(addr?.line2 || "");
    setCity(addr?.city || "");
    setProvince(addr?.province || "");
    setPostalCode(addr?.postalCode || "");
    setCountry(addr?.country || "CAN");
    setBusinessPhone(addr?.phone || "");
    setBusinessEmail(addr?.email || "");
    setIndustryDescription(addr?.industryDescription || "");
  }, [application]);

  const handleContinue = async () => {
    setError(null);
    if (!legalName.trim()) return setError("Legal business name is required.");
    if (!businessEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessEmail)) {
      return setError("A valid business email is required.");
    }
    if (mccCode && !/^\d{4}$/.test(mccCode)) {
      return setError("MCC must be a 4-digit numeric code.");
    }
    // Preserve the Step 2 extras that also live on businessAddress — we
    // don't want a Step 1 save to overwrite currencies / channels /
    // high-risk that Step 2 stored earlier.
    const priorAddr = (application?.businessAddress || {}) as Record<string, unknown>;
    const merged = {
      ...priorAddr,
      line1: line1.trim() || null,
      line2: line2.trim() || null,
      city: city.trim() || null,
      province: province.trim() || null,
      postalCode: postalCode.trim() || null,
      country: country || null,
      phone: businessPhone.trim() || null,
      email: businessEmail.trim().toLowerCase() || null,
      industryDescription: industryDescription.trim() || null,
    };
    try {
      await onSave({
        legalName: legalName.trim(),
        dbaName: dbaName.trim() || null,
        businessTypeName: businessTypeName || null,
        websiteUrl: websiteUrl.trim() || null,
        incorporationDate: incorporationDate || null,
        incorporationRegion: incorporationRegion.trim() || null,
        mccCode: mccCode || null,
        businessAddress: merged,
      });
      onNext();
    } catch {
      // toast already fired by wizard
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Business information</h2>
        <p className="text-sm text-gray-500">
          Match exactly what appears on your incorporation documents.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Legal business name *"
          value={legalName}
          onChange={(e) => setLegalName(e.target.value)}
          disabled={readOnly}
          placeholder="Acme Restaurants Inc."
        />
        <Input
          label="Trading name (DBA)"
          value={dbaName}
          onChange={(e) => setDbaName(e.target.value)}
          disabled={readOnly}
          placeholder="Acme Pizza"
        />
        <Select
          label="Business structure"
          value={businessTypeName}
          onChange={(e) => setBusinessTypeName(e.target.value)}
          disabled={readOnly}
          options={BUSINESS_TYPES}
          placeholder="Select…"
        />
        <Input
          label="Incorporation date"
          type="date"
          value={incorporationDate}
          onChange={(e) => setIncorporationDate(e.target.value)}
          disabled={readOnly}
        />
        <Input
          label="Jurisdiction of incorporation"
          value={incorporationRegion}
          onChange={(e) => setIncorporationRegion(e.target.value)}
          disabled={readOnly}
          placeholder="Ontario, Canada"
        />
        <Input
          label="Incorporation number"
          value={""}
          onChange={() => {}}
          disabled
          hint="Recorded during processor forwarding — not required to submit."
        />
        <Input
          label="Business phone"
          value={businessPhone}
          onChange={(e) => setBusinessPhone(e.target.value)}
          disabled={readOnly}
          placeholder="+1 555 123 4567"
        />
        <Input
          label="Business email *"
          type="email"
          value={businessEmail}
          onChange={(e) => setBusinessEmail(e.target.value)}
          disabled={readOnly}
          placeholder="ap@acme.ca"
        />
        <Input
          label="Website"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          disabled={readOnly}
          placeholder="https://www.acme.ca"
        />
        <Select
          label="MCC (Merchant Category Code) *"
          value={mccCode}
          onChange={(e) => setMccCode(e.target.value)}
          disabled={readOnly}
          options={COMMON_MCCS}
          placeholder="Select the closest match…"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Industry description
        </label>
        <textarea
          className="input w-full min-h-[80px]"
          value={industryDescription}
          onChange={(e) => setIndustryDescription(e.target.value)}
          disabled={readOnly}
          placeholder="A short description of what you sell / do."
        />
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Business address</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Street address"
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            disabled={readOnly}
          />
          <Input
            label="Address line 2"
            value={line2}
            onChange={(e) => setLine2(e.target.value)}
            disabled={readOnly}
          />
          <Input
            label="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            disabled={readOnly}
          />
          <Input
            label="Province / State"
            value={province}
            onChange={(e) => setProvince(e.target.value)}
            disabled={readOnly}
          />
          <Input
            label="Postal / Zip code"
            value={postalCode}
            onChange={(e) => setPostalCode(e.target.value)}
            disabled={readOnly}
          />
          <Select
            label="Country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            disabled={readOnly}
            options={COUNTRIES}
          />
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-600 flex items-center gap-1">
          <span>⚠</span>
          {error}
        </p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button variant="primary" onClick={handleContinue} loading={saving} disabled={readOnly}>
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
