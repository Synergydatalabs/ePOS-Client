// Step 3 — Ultimate Beneficial Owners. Card list + modal add/edit.
// UI cap: 10 UBOs (server also enforces). Owner-percent sum warning if
// > 100 %.

"use client";

import { useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { Button, Input, Select, Modal } from "@/components/ui";
import type { WizardApplication, WizardUbo } from "./types";

interface Props {
  application: WizardApplication | null;
  tenantId: string;
  readOnly: boolean;
  onChange: () => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}

const UI_CAP = 10;

const ID_TYPES: Array<{ value: WizardUbo["idType"]; label: string }> = [
  { value: "PASSPORT", label: "Passport" },
  { value: "DRIVERS_LICENSE", label: "Driver's licence" },
  { value: "NATIONAL_ID", label: "National ID" },
];

interface UboFormState {
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  addressCountry: string;
  ownershipPct: string;
  isDirector: boolean;
  isSignatory: boolean;
  idType: WizardUbo["idType"];
  idNumber: string;
  idExpiry: string;
  idIssuingCountry: string;
  sourceOfFunds: string;
  isPep: boolean;
}

const EMPTY_FORM: UboFormState = {
  fullName: "",
  dateOfBirth: "",
  nationality: "CAN",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "",
  postalCode: "",
  addressCountry: "CAN",
  ownershipPct: "",
  isDirector: false,
  isSignatory: false,
  idType: "PASSPORT",
  idNumber: "",
  idExpiry: "",
  idIssuingCountry: "CAN",
  sourceOfFunds: "",
  isPep: false,
};

function toFormState(ubo: WizardUbo): UboFormState {
  const addr = (ubo.residentialAddress || {}) as Record<string, string>;
  return {
    fullName: ubo.fullName || "",
    dateOfBirth: ubo.dateOfBirth ? new Date(ubo.dateOfBirth).toISOString().slice(0, 10) : "",
    nationality: ubo.nationality || "CAN",
    addressLine1: addr.line1 || "",
    addressLine2: addr.line2 || "",
    city: addr.city || "",
    province: addr.province || "",
    postalCode: addr.postalCode || "",
    addressCountry: addr.country || "CAN",
    ownershipPct: String(ubo.ownershipPct ?? ""),
    isDirector: ubo.isDirector,
    isSignatory: ubo.isSignatory,
    idType: ubo.idType,
    idNumber: "", // never returned by server; blank means "keep existing"
    idExpiry: ubo.idExpiry ? new Date(ubo.idExpiry).toISOString().slice(0, 10) : "",
    idIssuingCountry: ubo.idIssuingCountry || "CAN",
    sourceOfFunds: ubo.sourceOfFunds || "",
    isPep: ubo.isPep,
  };
}

export default function Step3Ubos({
  application,
  tenantId,
  readOnly,
  onChange,
  onBack,
  onNext,
}: Props) {
  const ubos = application?.ubos || [];
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<WizardUbo | null>(null);
  const [form, setForm] = useState<UboFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownershipTotal = useMemo(
    () => ubos.reduce((sum, u) => sum + Number(u.ownershipPct), 0),
    [ubos]
  );

  const openAdd = () => {
    if (ubos.length >= UI_CAP) {
      toast.error(`UBO limit reached (${UI_CAP}). Remove one before adding another.`);
      return;
    }
    setEditing(null);
    setForm(EMPTY_FORM);
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (ubo: WizardUbo) => {
    setEditing(ubo);
    setForm(toFormState(ubo));
    setError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
  };

  const handleSave = async () => {
    setError(null);
    if (!form.fullName.trim()) return setError("Full name is required.");
    if (!form.dateOfBirth) return setError("Date of birth is required.");
    if (!form.nationality || !/^[A-Z]{3}$/.test(form.nationality)) {
      return setError("Nationality must be a 3-letter ISO code.");
    }
    const ownership = Number(form.ownershipPct);
    if (!Number.isFinite(ownership) || ownership < 0 || ownership > 100) {
      return setError("Ownership % must be 0-100.");
    }
    // Require an ID number on add — edit accepts blank ("keep existing").
    if (!editing && !form.idNumber.trim()) {
      return setError("ID number is required.");
    }

    const payload: Record<string, unknown> = {
      fullName: form.fullName.trim(),
      dateOfBirth: form.dateOfBirth,
      nationality: form.nationality.toUpperCase(),
      residentialAddress: {
        line1: form.addressLine1.trim() || null,
        line2: form.addressLine2.trim() || null,
        city: form.city.trim() || null,
        province: form.province.trim() || null,
        postalCode: form.postalCode.trim() || null,
        country: form.addressCountry || null,
      },
      ownershipPct: ownership,
      isDirector: form.isDirector,
      isSignatory: form.isSignatory,
      idType: form.idType,
      idExpiry: form.idExpiry || null,
      idIssuingCountry: form.idIssuingCountry?.toUpperCase() || null,
      sourceOfFunds: form.sourceOfFunds.trim() || null,
      isPep: form.isPep,
    };
    if (form.idNumber.trim()) {
      payload.idNumber = form.idNumber.trim();
    }

    setSaving(true);
    try {
      const url = editing
        ? `/api/tenants/${tenantId}/onboarding/application/ubos/${editing.id}`
        : `/api/tenants/${tenantId}/onboarding/application/ubos`;
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success(editing ? "UBO updated" : "UBO added");
      setModalOpen(false);
      await onChange();
    } catch (e) {
      setError((e as Error).message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (ubo: WizardUbo) => {
    if (!confirm(`Remove ${ubo.fullName}?`)) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/onboarding/application/ubos/${ubo.id}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast.success("UBO removed");
      await onChange();
    } catch (e) {
      toast.error((e as Error).message || "Delete failed");
    }
  };

  const atCap = ubos.length >= UI_CAP;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Ultimate Beneficial Owners</h2>
          <p className="text-sm text-gray-500">
            Every individual owning 25 % or more of the business. Ownership must sum to 100 % across
            all UBOs.
          </p>
        </div>
        <div className="relative group">
          <Button
            variant="primary"
            icon="solar:user-plus-bold"
            disabled={readOnly || atCap}
            onClick={openAdd}
          >
            Add UBO
          </Button>
          {atCap && (
            <div className="absolute right-0 mt-1 hidden group-hover:block bg-gray-900 text-white text-xs rounded-md px-2 py-1 whitespace-nowrap">
              Limit is {UI_CAP} UBOs.
            </div>
          )}
        </div>
      </div>

      {ubos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 p-10 text-center text-sm text-gray-500">
          No UBOs added yet. Click <strong>Add UBO</strong> to start.
        </div>
      ) : (
        <>
          <div className={`rounded-xl px-3 py-2 text-xs font-medium ${
            ownershipTotal > 100
              ? "bg-red-50 text-red-800 border border-red-200"
              : ownershipTotal < 100
              ? "bg-amber-50 text-amber-800 border border-amber-200"
              : "bg-emerald-50 text-emerald-800 border border-emerald-200"
          }`}>
            Ownership total: {ownershipTotal.toFixed(2)}%{" "}
            {ownershipTotal > 100 && " — over 100 %, please fix."}
            {ownershipTotal < 100 && " — must sum to at least 100 % to submit."}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ubos.map((u) => (
              <div key={u.id} className="rounded-2xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-semibold text-gray-900">{u.fullName}</h3>
                  <span className="text-xs font-mono text-gray-500">
                    {Number(u.ownershipPct).toFixed(2)}%
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-600 mt-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400">DOB</p>
                    <p>{u.dateOfBirth ? new Date(u.dateOfBirth).toLocaleDateString() : "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400">
                      Nationality
                    </p>
                    <p>{u.nationality || "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400">ID</p>
                    <p>{u.idType.replaceAll("_", " ").toLowerCase()}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-400">ID Number</p>
                    <p className="font-mono">{u.hasIdNumber ? "•••• saved" : "—"}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {u.isDirector && <Chip>Director</Chip>}
                  {u.isSignatory && <Chip>Signatory</Chip>}
                  {u.isPep && <Chip tone="red">PEP</Chip>}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => openEdit(u)}
                    className="text-xs font-medium text-indigo-700 hover:underline disabled:opacity-40"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => handleDelete(u)}
                    className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onNext}>
          Continue
        </Button>
      </div>

      <Modal
        isOpen={modalOpen}
        onClose={closeModal}
        title={editing ? `Edit UBO — ${editing.fullName}` : "Add Ultimate Beneficial Owner"}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSave} loading={saving}>
              {editing ? "Save changes" : "Add UBO"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Full legal name *"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            />
            <Input
              label="Date of birth *"
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
            />
            <Input
              label="Nationality (ISO-3) *"
              value={form.nationality}
              maxLength={3}
              onChange={(e) => setForm({ ...form, nationality: e.target.value.toUpperCase() })}
              placeholder="CAN"
            />
            <Input
              label="Ownership % *"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.ownershipPct}
              onChange={(e) => setForm({ ...form, ownershipPct: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Residential address"
              value={form.addressLine1}
              onChange={(e) => setForm({ ...form, addressLine1: e.target.value })}
            />
            <Input
              label="Address line 2"
              value={form.addressLine2}
              onChange={(e) => setForm({ ...form, addressLine2: e.target.value })}
            />
            <Input
              label="City"
              value={form.city}
              onChange={(e) => setForm({ ...form, city: e.target.value })}
            />
            <Input
              label="Province / State"
              value={form.province}
              onChange={(e) => setForm({ ...form, province: e.target.value })}
            />
            <Input
              label="Postal / Zip"
              value={form.postalCode}
              onChange={(e) => setForm({ ...form, postalCode: e.target.value })}
            />
            <Input
              label="Country (ISO-3)"
              value={form.addressCountry}
              maxLength={3}
              onChange={(e) => setForm({ ...form, addressCountry: e.target.value.toUpperCase() })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.isDirector}
                onChange={(e) => setForm({ ...form, isDirector: e.target.checked })}
              />
              Director
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.isSignatory}
                onChange={(e) => setForm({ ...form, isSignatory: e.target.checked })}
              />
              Authorised signatory
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-2">
              <input
                type="checkbox"
                checked={form.isPep}
                onChange={(e) => setForm({ ...form, isPep: e.target.checked })}
              />
              Politically Exposed Person (PEP)
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
              label="ID document type *"
              value={form.idType}
              onChange={(e) =>
                setForm({ ...form, idType: e.target.value as WizardUbo["idType"] })
              }
              options={ID_TYPES}
            />
            <Input
              label={editing ? "ID number (leave blank to keep)" : "ID number *"}
              value={form.idNumber}
              onChange={(e) => setForm({ ...form, idNumber: e.target.value })}
              hint="Encrypted at rest — never sent back to the browser."
            />
            <Input
              label="ID expiry"
              type="date"
              value={form.idExpiry}
              onChange={(e) => setForm({ ...form, idExpiry: e.target.value })}
            />
            <Input
              label="Issuing country (ISO-3)"
              value={form.idIssuingCountry}
              maxLength={3}
              onChange={(e) =>
                setForm({ ...form, idIssuingCountry: e.target.value.toUpperCase() })
              }
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Source of funds
            </label>
            <textarea
              className="input w-full min-h-[80px]"
              value={form.sourceOfFunds}
              onChange={(e) => setForm({ ...form, sourceOfFunds: e.target.value })}
              placeholder="Salary, investments, business revenue, inheritance, etc."
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1">
              <Icon icon="solar:danger-circle-bold" className="w-4 h-4" />
              {error}
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

function Chip({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "red" }) {
  const cls =
    tone === "red" ? "bg-red-100 text-red-800" : "bg-gray-100 text-gray-700";
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}
