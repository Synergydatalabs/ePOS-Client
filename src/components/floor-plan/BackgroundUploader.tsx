"use client";

// ============================================================================
// BackgroundUploader — upload architect drawing / floor plan image to use as
// canvas underlay. Reuses Phase 1 S3 presigned URL flow (resourceType: 'floor_plan_bg').
//
// Used inside FloorSettingsDialog. Standalone so it's reusable later (e.g.
// in a quick "swap background" button in the toolbar).
// ============================================================================

import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface BackgroundUploaderProps {
  tenantId: string;
  currentUrl?: string | null;
  onUploaded: (publicUrl: string) => void;
  onCleared: () => void;
}

export default function BackgroundUploader({
  tenantId,
  currentUrl,
  onUploaded,
  onCleared,
}: BackgroundUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progressPct, setProgressPct] = useState<number>(0);

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // allow re-pick of same file

    // Size sanity check (we cap at 10MB by env var; floor plans are usually <2MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error("File too large. Max 10MB.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files supported (JPG, PNG, WebP)");
      return;
    }

    setUploading(true);
    setProgressPct(10);

    try {
      // 1. Request presigned URL
      const presignRes = await fetch(`/api/tenants/${tenantId}/uploads/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
          resourceType: "floor_plan_bg",
        }),
      });

      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({}));
        throw new Error(err.error || `Presign failed (${presignRes.status})`);
      }
      const presign = await presignRes.json();
      setProgressPct(30);

      // 2. PUT to S3
      const putRes = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: presign.uploadHeaders,
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`S3 upload failed: ${putRes.status}`);
      }
      setProgressPct(80);

      // 3. Confirm
      const confirmRes = await fetch(`/api/tenants/${tenantId}/uploads/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: presign.uploadId }),
      });
      if (!confirmRes.ok) {
        // The file is in S3 — confirm failure isn't fatal, just log
        console.warn("Confirm failed but S3 upload succeeded");
      }
      setProgressPct(100);

      toast.success("Background image uploaded");
      onUploaded(presign.publicUrl);
    } catch (err: any) {
      toast.error(`Upload failed: ${err?.message || "unknown"}`);
    } finally {
      setUploading(false);
      setProgressPct(0);
    }
  };

  return (
    <div className="space-y-3">
      {currentUrl ? (
        <div className="space-y-2">
          <div className="border border-gray-300 rounded-lg overflow-hidden bg-gray-50 max-h-40">
            <img
              src={currentUrl}
              alt="Floor plan background"
              className="w-full h-auto max-h-40 object-contain"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex-1 text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              Replace
            </button>
            <button
              type="button"
              onClick={onCleared}
              disabled={uploading}
              className="text-sm px-3 py-1.5 rounded text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="w-full py-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-indigo-400 hover:bg-indigo-50/40 flex flex-col items-center gap-2 disabled:opacity-50"
        >
          <Icon
            icon={uploading ? "solar:cloud-upload-bold" : "solar:gallery-add-bold"}
            className={`w-8 h-8 text-indigo-500 ${uploading ? "animate-pulse" : ""}`}
          />
          <span className="text-sm font-medium text-gray-700">
            {uploading ? `Uploading... ${progressPct}%` : "Upload architect drawing"}
          </span>
          <span className="text-xs text-gray-500">
            JPG, PNG, or WebP — max 10MB
          </span>
        </button>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handlePick}
        className="hidden"
      />

      {uploading && progressPct < 100 && (
        <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
          <div
            className="bg-indigo-600 h-full transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}
    </div>
  );
}
