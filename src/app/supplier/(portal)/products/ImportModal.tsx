"use client";

// CSV bulk-import modal for supplier products.
//
// Flow:
//   1. User downloads the template (link to /api/supplier/products/import/template)
//   2. User uploads a CSV → we parse it client-side with papaparse
//   3. Preview: show how many rows were parsed + a sanity-check table
//      (first 5 rows) + any obvious client-side warnings
//   4. Click Import → POST the parsed rows to the import endpoint
//   5. Result view: X imported, Y skipped, list of per-row errors,
//      list of auto-created categories
//
// Client-side parsing keeps the server bandwidth predictable and lets us
// show a preview instantly. The server does the authoritative validation
// (this UI's warnings are hints only — don't trust them for correctness).

import { useRef, useState } from "react";
import Papa from "papaparse";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { Modal, Button } from "@/components/ui";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImported: () => void; // parent refreshes the product list
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: { row: number; message: string }[];
  createdCategories: string[];
}

// The expected column names — mirror the template. We normalize incoming
// headers to lowercase-with-underscores so "Wholesale Price" / "wholesale
// price" / "wholesale_price" all work.
const EXPECTED_HEADERS = [
  "name",
  "sku",
  "category",
  "unit_label",
  "wholesale_price",
  "retail_price",
  "min_order_qty",
  "step_qty",
  "lead_time_days",
  "track_inventory",
  "stock_level",
  "low_stock_threshold",
  "description",
  "barcode",
  "is_public",
];

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, "_");
}

export default function ImportModal({ isOpen, onClose, onImported }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modal has three UI stages: "pick" (empty), "preview" (rows loaded),
  // "result" (server has responded). Cleaner than juggling booleans.
  const [stage, setStage] = useState<"pick" | "preview" | "result">("pick");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState<string>("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const reset = () => {
    setStage("pick");
    setRows([]);
    setFileName("");
    setWarnings([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const closeAndReset = () => {
    reset();
    onClose();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: normalizeHeader,
      complete: (parseResult) => {
        const data = parseResult.data.filter((row) =>
          // Drop rows where EVERY cell is empty (papaparse leaves them in
          // sometimes when a spreadsheet has trailing blank rows).
          Object.values(row).some((v) => v && String(v).trim() !== "")
        );

        // Header sanity check — warn about missing required columns.
        const headers = Object.keys(data[0] || {});
        const missingRequired: string[] = [];
        if (!headers.includes("name")) missingRequired.push("name");
        if (!headers.includes("wholesale_price")) missingRequired.push("wholesale_price");

        const unknownHeaders = headers.filter((h) => !EXPECTED_HEADERS.includes(h));

        const w: string[] = [];
        if (missingRequired.length) {
          w.push(
            `Missing required column${missingRequired.length !== 1 ? "s" : ""}: ${missingRequired.join(", ")}. Server will reject these rows.`
          );
        }
        if (unknownHeaders.length) {
          w.push(
            `Unknown column${unknownHeaders.length !== 1 ? "s" : ""} (will be ignored): ${unknownHeaders.join(", ")}`
          );
        }
        if (data.length === 0) {
          w.push("File is empty — no data rows found after the header.");
        }
        if (parseResult.errors && parseResult.errors.length) {
          w.push(
            `CSV parser warning${parseResult.errors.length !== 1 ? "s" : ""}: ${parseResult.errors[0].message}${
              parseResult.errors.length > 1 ? ` (+${parseResult.errors.length - 1} more)` : ""
            }`
          );
        }

        setRows(data);
        setWarnings(w);
        setStage("preview");
      },
      error: (err) => {
        toast.error(`Failed to parse CSV: ${err.message}`);
      },
    });
  };

  const submitImport = async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/api/supplier/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Import failed");
        setSubmitting(false);
        return;
      }
      setResult({
        imported: data.imported || 0,
        skipped: data.skipped || 0,
        errors: data.errors || [],
        createdCategories: data.createdCategories || [],
      });
      setStage("result");
      if (data.imported > 0) {
        toast.success(`Imported ${data.imported} product${data.imported !== 1 ? "s" : ""}`);
        onImported();
      }
    } catch {
      toast.error("Import failed");
    } finally {
      setSubmitting(false);
    }
  };

  // A small subset of columns for the preview grid — enough to sanity-check
  // that the CSV parsed correctly without a horizontal scroll.
  const previewColumns: { key: string; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "sku", label: "SKU" },
    { key: "category", label: "Category" },
    { key: "wholesale_price", label: "Wholesale" },
    { key: "unit_label", label: "Unit" },
  ];

  return (
    <Modal isOpen={isOpen} onClose={closeAndReset} title="Import Products from CSV" size="lg">
      {stage === "pick" && (
        <div className="space-y-5">
          <div className="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100 text-sm text-indigo-900">
            <div className="flex items-start gap-2">
              <Icon icon="solar:info-circle-bold" className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                Bulk import lets you add many products at once. Download the template,
                fill it in Excel / Google Sheets / Numbers, save as CSV, and upload here.
                Missing categories will be created automatically.
                <p className="text-xs text-indigo-700/80 mt-1">
                  Excel .xlsx support is coming — for now, use File → Save As → CSV.
                </p>
              </div>
            </div>
          </div>

          <div>
            <a
              href="/api/supplier/products/import/template"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 font-medium text-sm"
            >
              <Icon icon="solar:download-linear" className="w-4 h-4" />
              Download CSV template
            </a>
          </div>

          <div className="p-6 border-2 border-dashed border-gray-200 rounded-xl text-center">
            <Icon icon="solar:file-upload-linear" className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm font-medium text-gray-900 mb-1">Upload your filled-in CSV</p>
            <p className="text-xs text-gray-500 mb-4">Up to 1,000 rows per file</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFile}
            />
            <Button
              variant="secondary"
              icon="solar:upload-linear"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose CSV file
            </Button>
          </div>
        </div>
      )}

      {stage === "preview" && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-gray-900">{fileName}</p>
              <p className="text-sm text-gray-500">
                {rows.length} row{rows.length !== 1 ? "s" : ""} parsed
              </p>
            </div>
            <button
              onClick={reset}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Pick a different file
            </button>
          </div>

          {warnings.length > 0 && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-sm space-y-1.5">
              {warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-amber-900">
                  <Icon icon="solar:danger-triangle-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {rows.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Preview (first 5 rows)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {previewColumns.map((c) => (
                        <th key={c.key} className="text-left px-4 py-2 font-medium text-gray-600">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {previewColumns.map((c) => (
                          <td key={c.key} className="px-4 py-2 text-gray-900 truncate max-w-[200px]">
                            {row[c.key] || <span className="text-gray-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 5 && (
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
                  + {rows.length - 5} more row{rows.length - 5 !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={closeAndReset}>
              Cancel
            </Button>
            <Button onClick={submitImport} disabled={submitting || rows.length === 0}>
              {submitting
                ? "Importing…"
                : `Import ${rows.length} row${rows.length !== 1 ? "s" : ""}`}
            </Button>
          </div>
        </div>
      )}

      {stage === "result" && result && (
        <div className="space-y-5">
          <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-500 flex items-center justify-center">
                <Icon icon="solar:check-circle-bold" className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="font-bold text-gray-900 text-lg">
                  {result.imported} product{result.imported !== 1 ? "s" : ""} imported
                </p>
                {result.skipped > 0 && (
                  <p className="text-sm text-amber-700">
                    {result.skipped} row{result.skipped !== 1 ? "s" : ""} skipped — see below
                  </p>
                )}
              </div>
            </div>
          </div>

          {result.createdCategories.length > 0 && (
            <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
              <p className="text-sm font-semibold text-indigo-900 mb-1">
                Auto-created categor{result.createdCategories.length !== 1 ? "ies" : "y"}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {result.createdCategories.map((c) => (
                  <span key={c} className="text-xs px-2 py-0.5 rounded-full bg-white text-indigo-700 font-medium">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}

          {result.errors.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-gray-900 mb-2">
                Skipped rows ({result.errors.length})
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-gray-600 w-20">Row</th>
                      <th className="text-left px-4 py-2 font-medium text-gray-600">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {result.errors.map((err, i) => (
                      <tr key={i}>
                        <td className="px-4 py-2 font-mono text-gray-700">{err.row}</td>
                        <td className="px-4 py-2 text-red-700">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Fix these rows in your spreadsheet and re-upload — imported rows won't
                be duplicated (SKU / name dupes are rejected).
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={reset}>
              Import Another
            </Button>
            <Button onClick={closeAndReset}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
