"use client";

// ============================================================================
// VersionHistoryDialog — list previous versions, click to restore.
//
// Each restore creates a NEW version (audit trail preserved). So you can
// always restore back if you restore the wrong one.
// ============================================================================

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface VersionItem {
  id: string;
  versionNumber: number;
  note: string | null;
  savedAt: string;
  savedBy: { firstName: string | null; lastName: string | null; email: string } | null;
  tablesCount: number;
  sectionsCount: number;
  isCurrent: boolean;
}

interface VersionHistoryDialogProps {
  open: boolean;
  tenantId: string;
  locationId: string;
  floorPlanId: string | null;
  onClose: () => void;
  onRestored: () => void; // parent reloads floor data
}

export default function VersionHistoryDialog({
  open,
  tenantId,
  locationId,
  floorPlanId,
  onClose,
  onRestored,
}: VersionHistoryDialogProps) {
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<number | null>(null);

  useEffect(() => {
    if (!open || !floorPlanId) return;
    setLoading(true);
    fetch(
      `/api/tenants/${tenantId}/locations/${locationId}/floor-plans/${floorPlanId}/versions`
    )
      .then((r) => r.json())
      .then((data) => setVersions(data.versions ?? []))
      .catch((err) => toast.error(`Failed to load history: ${err?.message ?? "unknown"}`))
      .finally(() => setLoading(false));
  }, [open, tenantId, locationId, floorPlanId]);

  if (!open || !floorPlanId) return null;

  const handleRestore = async (version: VersionItem) => {
    if (version.isCurrent) return;
    if (
      !confirm(
        `Restore to version ${version.versionNumber}?\n\nThis will replace your current layout with the snapshot from ${formatDate(version.savedAt)}. The restore itself is saved as a new version, so you can undo it later.`
      )
    ) {
      return;
    }

    setRestoring(version.versionNumber);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/floor-plans/${floorPlanId}/restore/${version.versionNumber}`,
        { method: "POST" }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Restore failed (${res.status})`);
      }
      const data = await res.json();
      toast.success(
        `Restored version ${data.restoredFrom} (now at version ${data.newVersion})`
      );
      onRestored();
      onClose();
    } catch (err: any) {
      toast.error(`Restore failed: ${err?.message ?? "unknown"}`);
    } finally {
      setRestoring(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900">Version history</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Restore any previous version. The restore itself becomes a new version (full audit trail).
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
          >
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Icon icon="solar:refresh-bold" className="w-5 h-5 text-gray-400 animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center py-10 text-gray-500 text-sm">
              No versions yet. Click <strong>Publish</strong> in the editor to create your first snapshot.
            </div>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => {
                const savedByName = v.savedBy
                  ? [v.savedBy.firstName, v.savedBy.lastName].filter(Boolean).join(" ") ||
                    v.savedBy.email
                  : "Unknown";
                return (
                  <li
                    key={v.id}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg border ${
                      v.isCurrent
                        ? "border-indigo-200 bg-indigo-50/50"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                      <span className="text-sm font-bold text-indigo-700">v{v.versionNumber}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          Version {v.versionNumber}
                        </span>
                        {v.isCurrent && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {formatDate(v.savedAt)} by {savedByName}
                      </div>
                      <div className="text-xs text-gray-500">
                        {v.tablesCount} tables · {v.sectionsCount} sections
                        {v.note && (
                          <span className="ml-2 italic">— {v.note}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRestore(v)}
                      disabled={v.isCurrent || restoring !== null}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {restoring === v.versionNumber
                        ? "Restoring..."
                        : v.isCurrent
                          ? "Current"
                          : "Restore"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-md text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-CA", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
