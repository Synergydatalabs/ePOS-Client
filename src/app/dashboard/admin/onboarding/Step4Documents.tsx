// Step 4 — Document uploads. One slot per KYB doc type; each slot shows
// the current file (if any) or a drop-zone.
//
// Upload flow (all client-side):
//   1. POST /documents/presigned-url  → get { url, s3Key, headers }
//   2. fetch(url, { method: "PUT", body: file, headers })  → S3 accepts bytes
//   3. POST /documents { docType, s3Key, filename, mime, size, sha256? }
//      → creates KybDocument row.
//
// sha256 is best-effort — SubtleCrypto is used when available so we get
// tamper-evidence. If the browser lacks it (or the file is huge), the
// row stores an empty hash and the Phase 2e scan worker fills it in later.

"use client";

import { useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import type { WizardApplication, WizardDocument } from "./types";

interface Props {
  application: WizardApplication | null;
  tenantId: string;
  readOnly: boolean;
  onChange: () => Promise<void>;
  onBack: () => void;
  onNext: () => void;
}

// Hardcoded array — never `Object.values(Prisma.KybDocType)` at module
// scope (Phase 1a bug). Order controls slot rendering order in the grid.
const DOC_SLOTS: Array<{
  docType: string;
  label: string;
  hint: string;
  required?: boolean;
}> = [
  {
    docType: "ARTICLES_OF_INCORPORATION",
    label: "Articles of Incorporation",
    hint: "Or business registration certificate",
    required: true,
  },
  { docType: "BUSINESS_LICENSE", label: "Business Licence", hint: "Municipal / state licence" },
  { docType: "VOID_CHEQUE", label: "Void Cheque", hint: "For settlement account", required: true },
  { docType: "BANK_STATEMENT", label: "Bank Statement", hint: "Last 3 months preferred" },
  { docType: "UBO_ID_FRONT", label: "UBO ID (Front)", hint: "Passport / licence — front side" },
  { docType: "UBO_ID_BACK", label: "UBO ID (Back)", hint: "Passport / licence — back side" },
  { docType: "UBO_PROOF_OF_ADDRESS", label: "UBO Proof of Address", hint: "Utility bill / bank stmt" },
  { docType: "DIRECTOR_ID", label: "Director ID", hint: "If different from UBO" },
  { docType: "TAX_RETURN", label: "Tax Return", hint: "Most recent filed year" },
  { docType: "GST_HST_REGISTRATION", label: "GST / HST Registration", hint: "CRA certificate" },
  { docType: "OTHER", label: "Other", hint: "Anything else the processor asked for" },
];

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
]);
const MAX_BYTES = 10 * 1024 * 1024;

async function computeSha256Hex(file: File): Promise<string> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return "";
    const buf = await file.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    // Very large file or Safari private mode — leave empty and the row
    // stores "" — cleaner than pretending we hashed.
    return "";
  }
}

export default function Step4Documents({
  application,
  tenantId,
  readOnly,
  onChange,
  onBack,
  onNext,
}: Props) {
  const docs = application?.documents || [];

  // Group by docType so each slot renders the newest matching file.
  const bySlot = useMemo(() => {
    const map = new Map<string, WizardDocument[]>();
    for (const d of docs) {
      if (!map.has(d.docType)) map.set(d.docType, []);
      map.get(d.docType)!.push(d);
    }
    return map;
  }, [docs]);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Supporting documents</h2>
        <p className="text-sm text-gray-500">
          Upload the KYB paperwork below. PDF, JPG, PNG, or HEIC — 10 MB max per file, 50 MB total.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {DOC_SLOTS.map((slot) => (
          <DocSlot
            key={slot.docType}
            slot={slot}
            files={bySlot.get(slot.docType) || []}
            tenantId={tenantId}
            readOnly={readOnly}
            onChange={onChange}
          />
        ))}
      </div>

      <div className="flex justify-between gap-3 pt-2">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onNext}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function DocSlot({
  slot,
  files,
  tenantId,
  readOnly,
  onChange,
}: {
  slot: { docType: string; label: string; hint: string; required?: boolean };
  files: WizardDocument[];
  tenantId: string;
  readOnly: boolean;
  onChange: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = async (file: File) => {
    if (!ALLOWED_MIMES.has(file.type)) {
      toast.error(`Unsupported file type: ${file.type || file.name}`);
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 10MB).`);
      return;
    }
    setBusy(true);
    try {
      // 1) Presigned URL
      const presignRes = await fetch(
        `/api/tenants/${tenantId}/onboarding/application/documents/presigned-url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType: slot.docType,
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        }
      );
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || "Failed to sign upload");

      // 2) Direct PUT to S3. Content-Type MUST match — the presigned
      // signature covers it, and S3 rejects the upload otherwise.
      const putRes = await fetch(presign.url, {
        method: "PUT",
        body: file,
        headers: presign.headers,
      });
      if (!putRes.ok) {
        throw new Error(`S3 upload failed (${putRes.status})`);
      }

      // 3) Record the row. sha256 is best-effort.
      const sha256 = await computeSha256Hex(file);
      const rowRes = await fetch(
        `/api/tenants/${tenantId}/onboarding/application/documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType: slot.docType,
            s3Key: presign.s3Key,
            originalFilename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            sha256,
          }),
        }
      );
      const rowData = await rowRes.json();
      if (!rowRes.ok) throw new Error(rowData.error || "Failed to record document");

      toast.success(`${file.name} uploaded`);
      await onChange();
    } catch (e) {
      toast.error((e as Error).message || "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = async (docId: string, filename: string) => {
    if (!confirm(`Delete "${filename}"?`)) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/onboarding/application/documents/${docId}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      toast.success("Document removed");
      await onChange();
    } catch (e) {
      toast.error((e as Error).message || "Delete failed");
    }
  };

  const primary = files[0];

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {slot.label} {slot.required && <span className="text-red-500">*</span>}
          </p>
          <p className="text-xs text-gray-500">{slot.hint}</p>
        </div>
        {primary ? (
          <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-emerald-600 flex-shrink-0" />
        ) : (
          <Icon icon="solar:document-add-linear" className="w-5 h-5 text-gray-300 flex-shrink-0" />
        )}
      </div>

      {primary ? (
        <div className="mt-2 space-y-2">
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
            <p className="text-xs font-medium text-gray-900 truncate" title={primary.originalFilename}>
              {primary.originalFilename}
            </p>
            <p className="text-[10px] text-gray-500">
              {primary.mimeType} · {(primary.sizeBytes / 1024).toFixed(1)} KB
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={readOnly || busy}
              onClick={() => inputRef.current?.click()}
              className="text-xs font-medium text-indigo-700 hover:underline disabled:opacity-40"
            >
              Replace
            </button>
            <button
              type="button"
              disabled={readOnly || busy}
              onClick={() => handleDelete(primary.id, primary.originalFilename)}
              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
            >
              Delete
            </button>
          </div>
          {files.length > 1 && (
            <p className="text-[10px] text-gray-400">
              + {files.length - 1} older upload{files.length > 2 ? "s" : ""}
            </p>
          )}
        </div>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!readOnly && !busy) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (readOnly || busy) return;
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          onClick={() => (readOnly || busy ? null : inputRef.current?.click())}
          className={`mt-2 rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition ${
            dragOver
              ? "border-indigo-500 bg-indigo-50"
              : "border-gray-200 hover:border-indigo-300 hover:bg-gray-50"
          } ${readOnly || busy ? "cursor-not-allowed opacity-60" : ""}`}
        >
          {busy ? (
            <p className="text-xs text-gray-500">Uploading…</p>
          ) : (
            <>
              <Icon
                icon="solar:cloud-upload-bold"
                className="w-8 h-8 text-gray-400 mx-auto mb-1"
              />
              <p className="text-xs font-medium text-gray-700">Drop or click to upload</p>
              <p className="text-[10px] text-gray-400">PDF / JPG / PNG / HEIC · ≤10 MB</p>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/heic,image/heif"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
    </div>
  );
}
