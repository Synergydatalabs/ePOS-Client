"use client";

// ============================================================================
// MenuCsvUploader
//
// 3-step wizard:
//   1. Pick CSV file (papaparse → preview table + errors)
//   2. Pick images folder (HTML webkitdirectory → match filenames)
//   3. Review + Confirm → uploads images to S3 in parallel, then POSTs
//      the row data + image URLs to /menu/bulk-upload
//
// Browser support: webkitdirectory works on Chrome, Edge, Safari, Firefox.
// Falls back gracefully if user picks no folder (just no images attached).
// ============================================================================

import { useState, useMemo, useCallback, useRef } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import {
  parseMenuCsv,
  type ParseResult,
  type ParsedMenuRow,
} from "@/lib/csv/menu-import";

interface MenuCsvUploaderProps {
  tenantId: string;
  onSuccess?: (created: number) => void;
}

type WizardStep =
  | "pick-csv"
  | "pick-images"
  | "review"
  | "uploading"
  | "complete";

interface UploadProgress {
  total: number;
  completed: number;
  failed: number;
  currentFile?: string;
}

export default function MenuCsvUploader({ tenantId, onSuccess }: MenuCsvUploaderProps) {
  const [step, setStep] = useState<WizardStep>("pick-csv");
  const [csvFileName, setCsvFileName] = useState<string>("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [imageMap, setImageMap] = useState<Map<string, File>>(new Map());
  const [imagesPickedCount, setImagesPickedCount] = useState<number>(0);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [completionResult, setCompletionResult] = useState<{
    created: number;
    skipped: number;
    categoriesCreated: string[];
    errors: { rowNumber?: number; name: string; reason: string }[];
  } | null>(null);

  const csvInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Compute missing-image warnings based on imageMap
  const missingImageFilenames = useMemo(() => {
    if (!parseResult) return [];
    return parseResult.summary.distinctImages.filter(
      (filename) => !imageMap.has(filename.toLowerCase())
    );
  }, [parseResult, imageMap]);

  // ────────── Step 1: download template ──────────
  const downloadTemplate = async () => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/menu/template`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "menu-template.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast.error("Could not download template: " + (err?.message || "unknown"));
    }
  };

  // ────────── Step 1: pick CSV ──────────
  const handleCsvPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    const text = await file.text();
    const result = parseMenuCsv(text);
    setParseResult(result);

    if (result.errors.length > 0 && result.valid.length === 0) {
      toast.error(`CSV has ${result.errors.length} errors — fix them and try again`);
      return;
    }

    if (result.valid.length === 0) {
      toast.error("No valid rows found in CSV");
      return;
    }

    toast.success(`Parsed ${result.valid.length} valid rows`);

    // Auto-advance to image step if there are referenced images,
    // otherwise skip straight to review
    if (result.summary.distinctImages.length > 0) {
      setStep("pick-images");
    } else {
      setStep("review");
    }
  };

  // ────────── Step 2: pick images folder ──────────
  const handleFolderPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const map = new Map<string, File>();
    Array.from(files).forEach((f) => {
      // We store BY FILENAME LOWERCASED so matching is case-insensitive
      map.set(f.name.toLowerCase(), f);
    });

    setImageMap(map);
    setImagesPickedCount(files.length);

    const referenced = parseResult?.summary.distinctImages || [];
    const found = referenced.filter((fn) => map.has(fn.toLowerCase())).length;
    const missing = referenced.length - found;

    if (missing > 0) {
      toast.warning(`Found ${found}/${referenced.length} images. ${missing} missing.`);
    } else {
      toast.success(`All ${found} images matched ✓`);
    }
  };

  // ────────── Step 3: upload everything ──────────
  const handleConfirmUpload = async () => {
    if (!parseResult) return;

    setStep("uploading");
    setUploadProgress({
      total: parseResult.summary.distinctImages.length,
      completed: 0,
      failed: 0,
    });

    // Upload all images in parallel (limited concurrency to avoid hammering)
    const imageUrlByFilename = new Map<string, string>();
    const CONCURRENCY = 5;
    const queue = [...parseResult.summary.distinctImages];
    let completedCount = 0;
    let failedCount = 0;

    const uploadOne = async (filename: string) => {
      const file = imageMap.get(filename.toLowerCase());
      if (!file) {
        // Marked as missing in UI; just skip
        return;
      }

      setUploadProgress((p) =>
        p ? { ...p, currentFile: filename } : p
      );

      try {
        // 1. Request presigned URL
        const presignRes = await fetch(
          `/api/tenants/${tenantId}/uploads/presign`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type || "image/jpeg",
              size: file.size,
              resourceType: "product",
            }),
          }
        );

        if (!presignRes.ok) {
          const txt = await presignRes.text().catch(() => "");
          throw new Error(`presign failed: ${presignRes.status} ${txt}`);
        }
        const presign = await presignRes.json();

        // 2. PUT to S3
        const putRes = await fetch(presign.uploadUrl, {
          method: "PUT",
          headers: presign.uploadHeaders,
          body: file,
        });

        if (!putRes.ok) {
          throw new Error(`S3 PUT failed: ${putRes.status}`);
        }

        // 3. Confirm upload (marks PENDING -> COMPLETED in DB)
        const confirmRes = await fetch(
          `/api/tenants/${tenantId}/uploads/confirm`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uploadId: presign.uploadId }),
          }
        );

        if (!confirmRes.ok) {
          // Image is in S3 but DB tracking failed — log but don't fail
          console.warn(`Confirm failed for ${filename}; image still in S3`);
        }

        imageUrlByFilename.set(filename, presign.publicUrl);
        completedCount++;
      } catch (err: any) {
        console.error(`Upload failed for ${filename}:`, err);
        failedCount++;
      } finally {
        setUploadProgress((p) =>
          p
            ? {
                total: p.total,
                completed: completedCount,
                failed: failedCount,
                currentFile: undefined,
              }
            : p
        );
      }
    };

    // Process queue with concurrency limit
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        const filename = queue.shift();
        if (!filename) break;
        await uploadOne(filename);
      }
    });
    await Promise.all(workers);

    // 4. POST rows to bulk-upload
    const rowsPayload = parseResult.valid.map((r) => ({
      rowNumber: r.rowNumber,
      name: r.name,
      category: r.category,
      priceCents: r.priceCents,
      sku: r.sku,
      description: r.description,
      costCents: r.costCents,
      prepTimeMinutes: r.prepTimeMinutes,
      isActive: r.isActive,
      sortOrder: r.sortOrder,
      imageUrl: r.imageFilename
        ? imageUrlByFilename.get(r.imageFilename)
        : undefined,
    }));

    try {
      const bulkRes = await fetch(
        `/api/tenants/${tenantId}/menu/bulk-upload`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: rowsPayload }),
        }
      );

      if (!bulkRes.ok) {
        const txt = await bulkRes.text().catch(() => "");
        throw new Error(`bulk-upload failed: ${bulkRes.status} ${txt}`);
      }

      const bulkResult = await bulkRes.json();

      setCompletionResult({
        created: bulkResult.created,
        skipped: bulkResult.skipped,
        categoriesCreated: bulkResult.categoriesCreated,
        errors: bulkResult.errors,
      });

      setStep("complete");
      toast.success(`Created ${bulkResult.created} products`);
      onSuccess?.(bulkResult.created);
    } catch (err: any) {
      toast.error("Bulk create failed: " + (err?.message || "unknown"));
      setStep("review"); // back to review
    }
  };

  const reset = () => {
    setStep("pick-csv");
    setCsvFileName("");
    setParseResult(null);
    setImageMap(new Map());
    setImagesPickedCount(0);
    setUploadProgress(null);
    setCompletionResult(null);
    if (csvInputRef.current) csvInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  // ────────── Render ──────────
  return (
    <div className="space-y-4">
      {/* Progress dots */}
      <ProgressDots currentStep={step} />

      {/* Step content */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {step === "pick-csv" && (
          <div className="space-y-4 text-center">
            <Icon icon="solar:document-add-bold" className="w-16 h-16 text-indigo-500 mx-auto" />
            <h2 className="text-lg font-bold">Pick your CSV</h2>
            <p className="text-sm text-gray-600">
              Need a starter? Download the template below.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={downloadTemplate}
                className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 inline-flex items-center gap-2"
              >
                <Icon icon="solar:download-bold" className="w-4 h-4" />
                Download Template
              </button>
              <button
                onClick={() => csvInputRef.current?.click()}
                className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 inline-flex items-center gap-2"
              >
                <Icon icon="solar:upload-bold" className="w-4 h-4" />
                Choose CSV file
              </button>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvPick}
                className="hidden"
              />
            </div>
          </div>
        )}

        {step === "pick-images" && parseResult && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">Pick your images folder</h2>
                <p className="text-sm text-gray-600 mt-1">
                  We&apos;ll match images by filename to{" "}
                  <span className="font-semibold">
                    {parseResult.summary.distinctImages.length}
                  </span>{" "}
                  rows in your CSV.
                </p>
              </div>
              <button
                onClick={() => setStep("review")}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Skip — no images
              </button>
            </div>

            <button
              onClick={() => folderInputRef.current?.click()}
              className="w-full py-8 border-2 border-dashed border-gray-300 rounded-xl hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors flex flex-col items-center gap-2"
            >
              <Icon icon="solar:folder-with-files-bold" className="w-12 h-12 text-indigo-500" />
              <span className="font-medium text-gray-700">
                Click to select the folder containing your images
              </span>
              <span className="text-xs text-gray-500">
                We&apos;ll only upload files referenced in your CSV
              </span>
            </button>

            <input
              ref={folderInputRef}
              type="file"
              // @ts-expect-error — webkitdirectory is non-standard
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFolderPick}
              className="hidden"
            />

            {imagesPickedCount > 0 && (
              <div className="rounded-lg bg-gray-50 p-3 text-sm">
                <p className="font-medium mb-1">
                  Selected {imagesPickedCount} file(s) from your folder
                </p>
                <p className="text-gray-600">
                  Matched <span className="font-semibold text-green-700">
                    {parseResult.summary.distinctImages.length - missingImageFilenames.length}
                  </span> / {parseResult.summary.distinctImages.length} images
                </p>
                {missingImageFilenames.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-amber-700 cursor-pointer text-xs">
                      ⚠ {missingImageFilenames.length} missing — click to view
                    </summary>
                    <ul className="text-xs text-gray-600 list-disc pl-5 mt-1">
                      {missingImageFilenames.slice(0, 20).map((fn) => (
                        <li key={fn}>{fn}</li>
                      ))}
                      {missingImageFilenames.length > 20 && (
                        <li>...and {missingImageFilenames.length - 20} more</li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep("pick-csv")}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                ← Back
              </button>
              <button
                onClick={() => setStep("review")}
                disabled={imagesPickedCount === 0 && parseResult.summary.distinctImages.length > 0}
                className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue to Review →
              </button>
            </div>
          </div>
        )}

        {step === "review" && parseResult && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold">Review and confirm</h2>

            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Total rows" value={parseResult.summary.totalRows} />
              <Stat label="Valid rows" value={parseResult.summary.validRows} color="text-green-700" />
              <Stat label="Rows with errors" value={parseResult.summary.errorRows} color={parseResult.summary.errorRows > 0 ? "text-amber-700" : "text-gray-700"} />
              <Stat label="Categories" value={parseResult.summary.distinctCategories.length} />
            </div>

            {parseResult.errors.length > 0 && (
              <details className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
                <summary className="font-medium text-amber-800 cursor-pointer">
                  ⚠ {parseResult.errors.length} validation errors — click to view (these rows will be skipped)
                </summary>
                <ul className="mt-2 space-y-1 text-amber-900 list-disc pl-5">
                  {parseResult.errors.slice(0, 20).map((e, i) => (
                    <li key={i}>
                      Row {e.rowNumber}, {e.field}: {e.message}
                    </li>
                  ))}
                  {parseResult.errors.length > 20 && (
                    <li>...and {parseResult.errors.length - 20} more</li>
                  )}
                </ul>
              </details>
            )}

            {/* Sample preview table */}
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700">
                Preview (first 10 rows)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-y border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left">Row</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Category</th>
                      <th className="px-3 py-2 text-right">Price</th>
                      <th className="px-3 py-2 text-left">Image</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parseResult.valid.slice(0, 10).map((r) => (
                      <tr key={r.rowNumber}>
                        <td className="px-3 py-2 text-gray-500">{r.rowNumber}</td>
                        <td className="px-3 py-2 font-medium">{r.name}</td>
                        <td className="px-3 py-2">{r.category}</td>
                        <td className="px-3 py-2 text-right">
                          ${(r.priceCents / 100).toFixed(2)}
                        </td>
                        <td className="px-3 py-2">
                          {r.imageFilename ? (
                            imageMap.has(r.imageFilename.toLowerCase()) ? (
                              <span className="text-green-700">✓ {r.imageFilename}</span>
                            ) : (
                              <span className="text-amber-700">✗ {r.imageFilename}</span>
                            )
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Categories that will be created */}
            {parseResult.summary.distinctCategories.length > 0 && (
              <div className="text-xs text-gray-600">
                <span className="font-medium">Categories to be referenced:</span>{" "}
                {parseResult.summary.distinctCategories.join(", ")}
                <p className="mt-1">
                  (New categories are created automatically. Existing ones are reused.)
                </p>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button
                onClick={reset}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                Start over
              </button>
              <button
                onClick={handleConfirmUpload}
                className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 inline-flex items-center gap-2"
              >
                <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
                Create {parseResult.summary.validRows} products
              </button>
            </div>
          </div>
        )}

        {step === "uploading" && uploadProgress && (
          <div className="space-y-4 text-center py-6">
            <Icon icon="solar:cloud-upload-bold" className="w-16 h-16 text-indigo-500 mx-auto animate-pulse" />
            <h2 className="text-lg font-bold">Uploading images...</h2>
            <div className="max-w-md mx-auto space-y-2">
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all"
                  style={{
                    width: `${
                      uploadProgress.total > 0
                        ? Math.round(
                            ((uploadProgress.completed + uploadProgress.failed) /
                              uploadProgress.total) *
                              100
                          )
                        : 100
                    }%`,
                  }}
                />
              </div>
              <p className="text-sm text-gray-600">
                {uploadProgress.completed + uploadProgress.failed} / {uploadProgress.total} images
                {uploadProgress.failed > 0 && (
                  <span className="text-amber-700"> ({uploadProgress.failed} failed)</span>
                )}
              </p>
              {uploadProgress.currentFile && (
                <p className="text-xs text-gray-500">Uploading {uploadProgress.currentFile}...</p>
              )}
            </div>
          </div>
        )}

        {step === "complete" && completionResult && (
          <div className="space-y-4 text-center py-6">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
              <Icon icon="solar:check-circle-bold" className="w-10 h-10 text-green-600" />
            </div>
            <h2 className="text-lg font-bold">Menu upload complete!</h2>
            <div className="text-sm text-gray-600 space-y-1">
              <p>
                Created <span className="font-bold text-green-700">{completionResult.created}</span> products
              </p>
              {completionResult.categoriesCreated.length > 0 && (
                <p>
                  Created <span className="font-bold">{completionResult.categoriesCreated.length}</span> new categories:{" "}
                  {completionResult.categoriesCreated.join(", ")}
                </p>
              )}
              {completionResult.skipped > 0 && (
                <p className="text-amber-700">
                  Skipped {completionResult.skipped} rows (duplicate SKUs)
                </p>
              )}
            </div>
            <button
              onClick={reset}
              className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 inline-flex items-center gap-2"
            >
              <Icon icon="solar:add-circle-bold" className="w-4 h-4" />
              Upload another CSV
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color = "text-gray-900" }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

// Wizard step indicator. Extracted so TS doesn't narrow the `currentStep`
// union inside an inline .map callback (which was triggering false-positive
// "comparison has no overlap" errors).
function ProgressDots({ currentStep }: { currentStep: WizardStep }) {
  const stepOrder: { id: WizardStep; label: string }[] = [
    { id: "pick-csv", label: "1. CSV" },
    { id: "pick-images", label: "2. Images" },
    { id: "review", label: "3. Review" },
    { id: "complete", label: "Done" },
  ];
  // Map current step to numeric position for "is done" check
  const positionOf: Record<WizardStep, number> = {
    "pick-csv": 0,
    "pick-images": 1,
    "review": 2,
    "uploading": 2.5,
    "complete": 3,
  };
  const currentPos = positionOf[currentStep];

  return (
    <div className="flex items-center justify-center gap-2 py-3">
      {stepOrder.map((s) => {
        const stepPos = positionOf[s.id];
        const isActive = currentStep === s.id;
        const isDone = !isActive && currentPos > stepPos;
        return (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors ${
                isActive
                  ? "bg-indigo-600 text-white"
                  : isDone
                    ? "bg-green-500 text-white"
                    : "bg-gray-200 text-gray-500"
              }`}
            >
              {isDone ? "✓" : s.label.charAt(0)}
            </div>
            <span
              className={`text-xs ${
                isActive ? "text-indigo-700 font-medium" : "text-gray-500"
              }`}
            >
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
