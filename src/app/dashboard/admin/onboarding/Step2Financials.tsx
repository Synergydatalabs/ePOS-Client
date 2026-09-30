// Step 2 — projected volume, currencies, channels, tax id, bank info.
// Tax id + bank info are the first "sensitive" fields; the wizard sends
// plaintext over HTTPS and the API encrypts server-side via kyb-crypto.
//
// The wizard shows "•••• saved" for tax id / bank info once the row has
// them (`hasTaxId` / `hasBankInfo` from the server) rather than round-
// tripping the ciphertext. The user re-enters the values whenever they
// want to change them.

"use client";

import { useEffect, useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import type { FinancialsExtras, WizardApplication } from "./types";

interface Props {
  application: WizardApplication | null;
  tenantCurrency: string;
  readOnly: boolean;
  saving: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}

const CURRENCIES = [
  { value: "CAD", label: "CAD — Canadian Dollar" },
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "AUD", label: "AUD — Australian Dollar" },
];

const CHANNELS: Array<{ value: string; label: string; hint: string }> = [
  { value: "IN_PERSON", label: "In-person", hint: "Terminal at the counter" },
  { value: "ONLINE", label: "Online", hint: "Website / payment links" },
  { value: "MAIL_ORDER", label: "Mail / phone order", hint: "MOTO transactions" },
  { value: "RECURRING", label: "Recurring", hint: "Memberships / subscriptions" },
];

export default function Step2Financials({
  application,
  tenantCurrency,
  readOnly,
  saving,
  onSave,
  onBack,
  onNext,
}: Props) {
  const [projectedMonthly, setProjectedMonthly] = useState<string>("");
  const [averageTicket, setAverageTicket] = useState<string>("");
  const [currency, setCurrency] = useState<string>(tenantCurrency || "CAD");
  const [expectedCurrencies, setExpectedCurrencies] = useState<string[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [highRisk, setHighRisk] = useState<boolean>(false);
  const [highRiskDetails, setHighRiskDetails] = useState<string>("");

  // Tax id + bank fields — the checkbox "change" flag decides whether to
  // send them on save. Without it a saved-tax-id application would get
  // its ciphertext wiped every time the user hit Continue.
  const [changeTaxId, setChangeTaxId] = useState<boolean>(!application?.hasTaxId);
  const [taxIdInput, setTaxIdInput] = useState<string>("");

  const [changeBank, setChangeBank] = useState<boolean>(!application?.hasBankInfo);
  const [accountHolderName, setAccountHolderName] = useState<string>("");
  const [bankName, setBankName] = useState<string>("");
  const [institutionNumber, setInstitutionNumber] = useState<string>("");
  const [transitNumber, setTransitNumber] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState<string>("");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!application) return;
    setProjectedMonthly(
      application.projectedMonthlyVolumeCents != null
        ? (application.projectedMonthlyVolumeCents / 100).toString()
        : ""
    );
    setAverageTicket(
      application.averageTicketCents != null
        ? (application.averageTicketCents / 100).toString()
        : ""
    );
    setCurrency(application.currency || tenantCurrency || "CAD");
    const extras = (application.businessAddress || {}) as FinancialsExtras;
    setExpectedCurrencies(extras.expectedCurrencies || []);
    setChannels(extras.channels || []);
    setHighRisk(!!extras.highRisk);
    setHighRiskDetails(extras.highRiskDetails || "");

    setChangeTaxId(!application.hasTaxId);
    setChangeBank(!application.hasBankInfo);
  }, [application, tenantCurrency]);

  const toggleInArray = (arr: string[], value: string) =>
    arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];

  const handleContinue = async () => {
    setError(null);
    const monthly = Number(projectedMonthly);
    const ticket = Number(averageTicket);
    if (!Number.isFinite(monthly) || monthly < 0) {
      return setError("Projected monthly volume must be a non-negative number.");
    }
    if (!Number.isFinite(ticket) || ticket < 0) {
      return setError("Average ticket must be a non-negative number.");
    }
    if (channels.length === 0) {
      return setError("Select at least one acceptance channel.");
    }
    if (changeTaxId && !taxIdInput.trim()) {
      return setError("Enter a tax ID or uncheck the change box.");
    }
    if (changeBank) {
      if (!accountHolderName.trim()) return setError("Bank account holder name is required.");
      if (!accountNumber.trim()) return setError("Bank account number is required.");
    }

    // Preserve Step 1 fields already on businessAddress + write extras.
    const priorAddr = (application?.businessAddress || {}) as Record<string, unknown>;
    const merged = {
      ...priorAddr,
      expectedCurrencies: expectedCurrencies.length ? expectedCurrencies : null,
      channels: channels.length ? channels : null,
      highRisk,
      highRiskDetails: highRisk ? highRiskDetails.trim() || null : null,
    };

    const patch: Record<string, unknown> = {
      projectedMonthlyVolumeCents: Math.round(monthly * 100),
      averageTicketCents: Math.round(ticket * 100),
      currency,
      businessAddress: merged,
    };
    if (changeTaxId) patch.taxId = taxIdInput.trim();
    if (changeBank) {
      patch.bankInfo = {
        accountHolderName: accountHolderName.trim(),
        bankName: bankName.trim() || null,
        institutionNumber: institutionNumber.trim() || null,
        transitNumber: transitNumber.trim() || null,
        accountNumber: accountNumber.trim(),
      };
    }

    try {
      await onSave(patch);
      onNext();
    } catch {
      // toast fired by wizard
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Financial profile</h2>
        <p className="text-sm text-gray-500">
          Projections help us route your application to the right processor.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Input
          label={`Projected monthly volume (${currency}) *`}
          type="number"
          min="0"
          step="0.01"
          value={projectedMonthly}
          onChange={(e) => setProjectedMonthly(e.target.value)}
          disabled={readOnly}
          placeholder="50000"
        />
        <Input
          label={`Average ticket size (${currency}) *`}
          type="number"
          min="0"
          step="0.01"
          value={averageTicket}
          onChange={(e) => setAverageTicket(e.target.value)}
          disabled={readOnly}
          placeholder="45"
        />
        <Select
          label="Settlement currency *"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          disabled={readOnly}
          options={CURRENCIES}
        />
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-900 mb-2">Additional accepted currencies</p>
        <div className="flex flex-wrap gap-2">
          {CURRENCIES.map((c) => {
            const on = expectedCurrencies.includes(c.value);
            return (
              <button
                type="button"
                key={c.value}
                onClick={() => setExpectedCurrencies((prev) => toggleInArray(prev, c.value))}
                disabled={readOnly}
                className={`text-xs rounded-full px-3 py-1.5 border transition ${
                  on
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                } ${readOnly ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                {c.value}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-sm font-semibold text-gray-900 mb-2">Acceptance channels *</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CHANNELS.map((ch) => {
            const on = channels.includes(ch.value);
            return (
              <label
                key={ch.value}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer transition ${
                  on ? "border-indigo-600 bg-indigo-50" : "border-gray-200 hover:bg-gray-50"
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={on}
                  disabled={readOnly}
                  onChange={() => setChannels((prev) => toggleInArray(prev, ch.value))}
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">{ch.label}</p>
                  <p className="text-xs text-gray-500">{ch.hint}</p>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <input
            type="checkbox"
            checked={highRisk}
            disabled={readOnly}
            onChange={(e) => setHighRisk(e.target.checked)}
          />
          High-risk products or services
        </label>
        <p className="text-xs text-gray-500 mt-1">
          E.g. crypto, cannabis, adult content, gambling, high-ticket electronics, travel.
        </p>
        {highRisk && (
          <textarea
            className="input mt-3 w-full min-h-[80px]"
            value={highRiskDetails}
            disabled={readOnly}
            onChange={(e) => setHighRiskDetails(e.target.value)}
            placeholder="Describe the high-risk products / services."
          />
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-900">Tax ID</p>
          {application?.hasTaxId && !changeTaxId && (
            <button
              type="button"
              onClick={() => setChangeTaxId(true)}
              disabled={readOnly}
              className="text-xs font-medium text-indigo-700 hover:underline"
            >
              Change
            </button>
          )}
        </div>
        {changeTaxId ? (
          <Input
            label="Business tax ID (EIN / BN / TIN)"
            value={taxIdInput}
            onChange={(e) => setTaxIdInput(e.target.value)}
            disabled={readOnly}
            placeholder="12-3456789 or 123456789 RC0001"
            hint="Encrypted at rest — never sent back to the browser after saving."
          />
        ) : application?.hasTaxId ? (
          <p className="text-sm text-gray-700 font-mono">•••• saved (last 4 shown to admins only)</p>
        ) : (
          <p className="text-sm text-gray-500">Not provided yet.</p>
        )}
      </div>

      <div className="rounded-2xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-gray-900">Bank account (settlement)</p>
          {application?.hasBankInfo && !changeBank && (
            <button
              type="button"
              onClick={() => setChangeBank(true)}
              disabled={readOnly}
              className="text-xs font-medium text-indigo-700 hover:underline"
            >
              Change
            </button>
          )}
        </div>
        {changeBank ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Account holder name *"
              value={accountHolderName}
              onChange={(e) => setAccountHolderName(e.target.value)}
              disabled={readOnly}
            />
            <Input
              label="Bank name"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              disabled={readOnly}
            />
            <Input
              label="Institution number"
              value={institutionNumber}
              onChange={(e) => setInstitutionNumber(e.target.value)}
              disabled={readOnly}
              placeholder="003"
            />
            <Input
              label="Transit / routing number"
              value={transitNumber}
              onChange={(e) => setTransitNumber(e.target.value)}
              disabled={readOnly}
              placeholder="12345"
            />
            <div className="md:col-span-2">
              <Input
                label="Account number *"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                disabled={readOnly}
                hint="Encrypted at rest — never sent back to the browser after saving."
              />
            </div>
          </div>
        ) : application?.hasBankInfo ? (
          <p className="text-sm text-gray-700 font-mono">•••• saved (last 4 shown to admins only)</p>
        ) : (
          <p className="text-sm text-gray-500">Not provided yet.</p>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 flex items-center gap-1">
          <span>⚠</span>
          {error}
        </p>
      )}

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={handleContinue} loading={saving} disabled={readOnly}>
          Save & Continue
        </Button>
      </div>
    </div>
  );
}
