"use client";

// ============================================================================
// RestaurantMediaGallery — admin UI to manage photos, videos, and 360° panoramas
// for a restaurant location.
//
// Features:
//   - Upload via drag-drop or button (multiple files)
//   - Auto-detect media type (image -> PHOTO, video -> VIDEO, panorama by toggle)
//   - Show grid of thumbnails with type badge
//   - Click to view detail (caption, alt text, set cover, mark as 360°)
//   - Reorder via up/down buttons (drag-drop in a later iteration)
//   - Delete (soft by default; hard delete option in detail panel)
//
// Reuses Phase 1 S3 presigned URL flow. Registers media in DB after upload.
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface MediaItem {
  id: string;
  mediaType: "PHOTO" | "VIDEO" | "PANORAMA_360";
  s3Key: string;
  publicUrl: string;
  thumbnailUrl: string | null;
  fileSizeBytes: number | null;
  widthPx: number | null;
  heightPx: number | null;
  durationSeconds: number | null;
  caption: string | null;
  altText: string | null;
  displayOrder: number;
  isCover: boolean;
  sceneName: string | null;
  initialYaw: number | null;
  initialPitch: number | null;
  initialFov: number | null;
  sectionId: string | null;
  createdAt: string;
}

interface RestaurantMediaGalleryProps {
  tenantId: string;
  locationId: string;
}

interface PendingUpload {
  id: string; // temp local id
  file: File;
  progressPct: number;
  error?: string;
}

const ACCEPT_TYPES =
  "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime";

export default function RestaurantMediaGallery({
  tenantId,
  locationId,
}: RestaurantMediaGalleryProps) {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // ────────────────────────── load ──────────────────────────
  const loadItems = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/media`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (err: any) {
      toast.error(`Couldn't load media: ${err?.message ?? "unknown"}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, locationId]);

  // ────────────────────────── upload ──────────────────────────
  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    // Validate
    const valid: File[] = [];
    for (const f of list) {
      if (!ACCEPT_TYPES.includes(f.type)) {
        toast.error(`${f.name}: unsupported file type`);
        continue;
      }
      // Photos/videos cap differently — leave server validation to enforce 10MB default
      valid.push(f);
    }
    if (valid.length === 0) return;

    // Queue all as PENDING in UI
    const queued: PendingUpload[] = valid.map((f) => ({
      id: `${Date.now()}-${f.name}-${Math.random()}`,
      file: f,
      progressPct: 0,
    }));
    setPending((p) => [...p, ...queued]);

    // Upload in parallel (max 3 at a time)
    const CONCURRENCY = 3;
    const queue = [...queued];
    const workers = Array.from(
      { length: Math.min(CONCURRENCY, queue.length) },
      async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          await uploadOne(item);
        }
      }
    );
    await Promise.all(workers);

    await loadItems();
  };

  const uploadOne = async (item: PendingUpload) => {
    try {
      const isVideo = item.file.type.startsWith("video/");
      const mediaType = isVideo ? "VIDEO" : "PHOTO"; // 360° is toggled later in detail panel

      // Update progress
      const updateProgress = (pct: number) => {
        setPending((p) =>
          p.map((x) => (x.id === item.id ? { ...x, progressPct: pct } : x))
        );
      };
      updateProgress(10);

      // 1. Presign
      const presignRes = await fetch(`/api/tenants/${tenantId}/uploads/presign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: item.file.name,
          contentType: item.file.type,
          size: item.file.size,
          resourceType: "restaurant_media",
        }),
      });
      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({}));
        throw new Error(err.error || `Presign failed (${presignRes.status})`);
      }
      const presign = await presignRes.json();
      updateProgress(25);

      // 2. PUT to S3
      const putRes = await fetch(presign.uploadUrl, {
        method: "PUT",
        headers: presign.uploadHeaders,
        body: item.file,
      });
      if (!putRes.ok) {
        throw new Error(`S3 upload failed (${putRes.status})`);
      }
      updateProgress(75);

      // 3. Confirm
      await fetch(`/api/tenants/${tenantId}/uploads/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: presign.uploadId }),
      });
      updateProgress(90);

      // 4. Get image dimensions if possible (best-effort, won't fail upload)
      let widthPx: number | undefined;
      let heightPx: number | undefined;
      if (!isVideo) {
        try {
          const dims = await getImageDimensions(item.file);
          widthPx = dims.width;
          heightPx = dims.height;
        } catch {}
      }

      // 5. Register in DB
      const registerRes = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mediaType,
            s3Key: presign.s3Key,
            publicUrl: presign.publicUrl,
            fileSizeBytes: item.file.size,
            ...(widthPx && { widthPx }),
            ...(heightPx && { heightPx }),
          }),
        }
      );
      if (!registerRes.ok) {
        const err = await registerRes.json().catch(() => ({}));
        throw new Error(err.error || `Register failed (${registerRes.status})`);
      }
      updateProgress(100);

      // Remove from pending
      setPending((p) => p.filter((x) => x.id !== item.id));
    } catch (err: any) {
      setPending((p) =>
        p.map((x) => (x.id === item.id ? { ...x, error: err.message } : x))
      );
      toast.error(`${item.file.name}: ${err.message}`);
    }
  };

  // ────────────────────────── actions ──────────────────────────
  const handleSetCover = async (item: MediaItem) => {
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/media/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isCover: true }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Cover photo set");
      await loadItems();
    } catch (err: any) {
      toast.error(`Couldn't set cover: ${err?.message ?? "unknown"}`);
    }
  };

  const handleMarkAs360 = async (item: MediaItem) => {
    const sceneName = prompt(
      "Scene name (e.g., Entrance, Main Dining, Bar, Patio):",
      item.sceneName || ""
    );
    if (sceneName === null) return; // user cancelled
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/media/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sceneName: sceneName.trim() || null,
          }),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Marked as 360° scene");
      await loadItems();
    } catch (err: any) {
      toast.error(`Failed: ${err?.message ?? "unknown"}`);
    }
  };

  const handleUpdate = async (id: string, updates: Partial<MediaItem>) => {
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/media/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadItems();
    } catch (err: any) {
      toast.error(`Update failed: ${err?.message ?? "unknown"}`);
    }
  };

  const handleDelete = async (item: MediaItem) => {
    if (!confirm(`Delete this ${item.mediaType.toLowerCase()}?`)) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/media/${item.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success("Deleted");
      setSelected(null);
      await loadItems();
    } catch (err: any) {
      toast.error(`Delete failed: ${err?.message ?? "unknown"}`);
    }
  };

  // ────────────────────────── render ──────────────────────────
  return (
    <div className="space-y-4">
      {/* Drop zone / upload trigger */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
        }}
        className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
          dragOver
            ? "border-indigo-500 bg-indigo-50"
            : "border-gray-300 bg-white hover:border-indigo-400 hover:bg-indigo-50/40"
        }`}
      >
        <Icon
          icon="solar:gallery-add-bold"
          className="w-10 h-10 mx-auto text-indigo-500 mb-2"
        />
        <p className="text-sm font-medium text-gray-700">
          Drop photos or videos here
        </p>
        <p className="text-xs text-gray-500 mt-1">
          JPG, PNG, WebP, GIF, MP4, WebM, MOV — max 10MB each
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="mt-3 px-4 py-1.5 text-sm font-medium text-indigo-700 bg-indigo-100 rounded-md hover:bg-indigo-200"
        >
          Or click to browse
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_TYPES}
          multiple
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
          className="hidden"
        />
      </div>

      {/* Pending uploads */}
      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
          <p className="text-xs font-medium text-amber-900">
            Uploading {pending.length} file(s)...
          </p>
          {pending.map((p) => (
            <div key={p.id}>
              <div className="flex justify-between text-xs text-amber-900">
                <span className="truncate">{p.file.name}</span>
                <span>{p.error ? "❌" : `${p.progressPct}%`}</span>
              </div>
              {!p.error && (
                <div className="w-full h-1 bg-amber-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all"
                    style={{ width: `${p.progressPct}%` }}
                  />
                </div>
              )}
              {p.error && (
                <p className="text-xs text-red-700 mt-1">{p.error}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Gallery */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Icon
            icon="solar:refresh-bold"
            className="w-5 h-5 text-gray-400 animate-spin"
          />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">
          No photos or videos yet. Upload some above.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {items.map((item) => (
            <MediaTile
              key={item.id}
              item={item}
              onClick={() => setSelected(item)}
              onSetCover={() => handleSetCover(item)}
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <DetailDialog
          item={selected}
          onClose={() => setSelected(null)}
          onUpdate={(updates) => handleUpdate(selected.id, updates)}
          onSetCover={() => handleSetCover(selected)}
          onMarkAs360={() => handleMarkAs360(selected)}
          onDelete={() => handleDelete(selected)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function MediaTile({
  item,
  onClick,
  onSetCover,
}: {
  item: MediaItem;
  onClick: () => void;
  onSetCover: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="relative group cursor-pointer rounded-lg overflow-hidden bg-gray-100 border border-gray-200 hover:border-indigo-400 transition-colors aspect-square"
    >
      {item.mediaType === "VIDEO" ? (
        <div className="relative w-full h-full bg-black">
          <video
            src={item.publicUrl}
            className="w-full h-full object-cover"
            muted
            playsInline
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <Icon
              icon="solar:play-circle-bold"
              className="w-10 h-10 text-white/80 drop-shadow"
            />
          </div>
        </div>
      ) : (
        <img
          src={item.thumbnailUrl || item.publicUrl}
          alt={item.altText || item.caption || "Restaurant photo"}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}

      {/* Badges */}
      <div className="absolute top-1 left-1 flex flex-col gap-1">
        {item.isCover && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-amber-900">
            ★ COVER
          </span>
        )}
        {item.sceneName && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500 text-white">
            360°
          </span>
        )}
        {item.mediaType === "VIDEO" && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-black/60 text-white">
            VIDEO
          </span>
        )}
      </div>

      {/* Hover overlay with quick cover button */}
      {!item.isCover && (
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end justify-end p-2 opacity-0 group-hover:opacity-100">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSetCover();
            }}
            className="text-xs px-2 py-1 rounded bg-white text-gray-900 font-medium shadow"
            title="Set as cover photo"
          >
            ★ Set cover
          </button>
        </div>
      )}
    </div>
  );
}

function DetailDialog({
  item,
  onClose,
  onUpdate,
  onSetCover,
  onMarkAs360,
  onDelete,
}: {
  item: MediaItem;
  onClose: () => void;
  onUpdate: (u: Partial<MediaItem>) => Promise<void>;
  onSetCover: () => Promise<void>;
  onMarkAs360: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [caption, setCaption] = useState(item.caption ?? "");
  const [altText, setAltText] = useState(item.altText ?? "");

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">
            {item.mediaType === "PHOTO"
              ? "Photo"
              : item.mediaType === "VIDEO"
                ? "Video"
                : "360° Panorama"}
            {item.isCover && (
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                Cover
              </span>
            )}
            {item.sceneName && (
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-800">
                360°: {item.sceneName}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded hover:bg-gray-100"
          >
            <Icon icon="solar:close-circle-bold" className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Preview */}
          <div className="bg-gray-900 rounded-lg overflow-hidden flex items-center justify-center max-h-96">
            {item.mediaType === "VIDEO" ? (
              <video src={item.publicUrl} controls className="max-h-96 w-auto" />
            ) : (
              <img
                src={item.publicUrl}
                alt={item.altText || ""}
                className="max-h-96 w-auto"
              />
            )}
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
            {item.widthPx && (
              <Stat label="Dimensions">
                {item.widthPx} × {item.heightPx} px
              </Stat>
            )}
            {item.fileSizeBytes && (
              <Stat label="Size">{formatBytes(item.fileSizeBytes)}</Stat>
            )}
            {item.durationSeconds && (
              <Stat label="Duration">{formatDuration(item.durationSeconds)}</Stat>
            )}
            <Stat label="Order">#{item.displayOrder}</Stat>
          </div>

          {/* Caption */}
          <Field label="Caption">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              onBlur={() => {
                if (caption !== (item.caption ?? "")) {
                  onUpdate({ caption: caption || null } as any);
                }
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Brief description (visible to customers)"
            />
          </Field>

          {/* Alt text */}
          <Field label="Alt text (accessibility)">
            <input
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              onBlur={() => {
                if (altText !== (item.altText ?? "")) {
                  onUpdate({ altText: altText || null } as any);
                }
              }}
              className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Description for screen readers"
            />
          </Field>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
            {!item.isCover && item.mediaType === "PHOTO" && (
              <button
                onClick={onSetCover}
                className="px-3 py-1.5 text-sm rounded border border-amber-300 text-amber-800 hover:bg-amber-50"
              >
                ★ Set as cover
              </button>
            )}
            {item.mediaType === "PHOTO" && (
              <button
                onClick={onMarkAs360}
                className="px-3 py-1.5 text-sm rounded border border-purple-300 text-purple-800 hover:bg-purple-50"
              >
                {item.sceneName
                  ? `Edit 360° scene name (${item.sceneName})`
                  : "Mark as 360° panorama"}
              </button>
            )}
            <button
              onClick={onDelete}
              className="ml-auto px-3 py-1.5 text-sm rounded border border-red-300 text-red-700 hover:bg-red-50"
            >
              Delete
            </button>
          </div>

          {item.mediaType === "PHOTO" && (
            <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
              💡 Tip: For 360° panoramas, upload an{" "}
              <strong>equirectangular photo</strong> (2:1 aspect ratio, e.g.
              4000×2000 px). Then click &quot;Mark as 360° panorama&quot; and
              give the scene a name. These become navigable scenes in the
              virtual tour (Phase 3c).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded bg-gray-50 px-2 py-1.5">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-xs font-medium text-gray-900 mt-0.5">{children}</p>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  return `${n.toFixed(u === 0 ? 0 : 1)} ${units[u]}`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't read image dimensions"));
    };
    img.src = url;
  });
}
