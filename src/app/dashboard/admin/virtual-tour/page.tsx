"use client";

// ============================================================================
// /dashboard/admin/virtual-tour
//
// Admin page hosting the TourSceneEditor. Also shows:
//   - Default scene picker
//   - Public URL (copyable) — /tour/<slug>
//   - Embed code (iframe snippet)
//   - Help section
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import TourSceneEditor from "@/components/virtual-tour/TourSceneEditor";
import type { TourScene, TourTable } from "@/lib/virtual-tour/types";

interface LocationOption {
  id: string;
  name: string;
}

interface TourPayload {
  location: { id: string; name: string; publicTourSlug: string };
  scenes: TourScene[];
  tables: TourTable[];
}

export default function VirtualTourPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [tour, setTour] = useState<TourPayload | null>(null);
  const [loadingTour, setLoadingTour] = useState(false);

  useEffect(() => {
    setTenantId(localStorage.getItem("tap_active_tenant"));
    setLocationId(localStorage.getItem("tap_active_location"));
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/tenants/${tenantId}/locations`)
      .then((r) => r.json())
      .then((data) => {
        const list: LocationOption[] = data.locations ?? [];
        setLocations(list);
        if (!locationId && list[0]) {
          setLocationId(list[0].id);
          localStorage.setItem("tap_active_location", list[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingLocations(false));
  }, [tenantId, locationId]);

  const loadTour = useCallback(async () => {
    if (!tenantId || !locationId) return;
    setLoadingTour(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/tour`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTour(data);
    } catch (err: any) {
      toast.error(`Couldn't load tour: ${err?.message ?? "unknown"}`);
    } finally {
      setLoadingTour(false);
    }
  }, [tenantId, locationId]);

  useEffect(() => {
    loadTour();
  }, [loadTour]);

  const handleSetDefault = async (sceneId: string) => {
    if (!tenantId || !locationId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/tour`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultSceneMediaId: sceneId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success("Default scene updated");
      await loadTour();
    } catch (err: any) {
      toast.error(`Failed: ${err?.message ?? "unknown"}`);
    }
  };

  const handleLocationChange = (id: string) => {
    setLocationId(id);
    localStorage.setItem("tap_active_location", id);
  };

  if (!tenantId || loadingLocations) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Virtual Tour" />
        <div className="flex items-center justify-center py-20">
          <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
        </div>
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50">
        <AdminHeader title="Virtual Tour" />
        <div className="max-w-md mx-auto py-20 text-center text-gray-600">
          <Icon icon="solar:vr-bold" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm">Add a location first.</p>
        </div>
      </div>
    );
  }

  const publicUrl = tour ? `${window.location.origin}/tour/${tour.location.publicTourSlug}` : "";
  const embedCode = tour
    ? `<iframe src="${publicUrl}?embed=1" style="border:0;width:100%;height:600px;max-width:100%" allow="accelerometer; gyroscope; fullscreen"></iframe>`
    : "";

  return (
    <div className="min-h-screen bg-gray-50">
      <AdminHeader
        title="Virtual Tour"
        subtitle="360° walkthrough — link panoramic scenes with hotspots"
        actions={
          locations.length > 1 ? (
            <select
              value={locationId ?? ""}
              onChange={(e) => handleLocationChange(e.target.value)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-md bg-white"
            >
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          ) : null
        }
      />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Help / first-time intro */}
        <details className="bg-white rounded-lg border border-gray-200 p-4">
          <summary className="font-medium cursor-pointer text-gray-900 flex items-center gap-2">
            <Icon icon="solar:info-circle-bold" className="w-4 h-4 text-indigo-600" />
            How to set up your virtual tour
          </summary>
          <ol className="mt-3 space-y-2 text-sm text-gray-700 list-decimal pl-5">
            <li>
              In <strong>Media Gallery</strong>, upload equirectangular 360° photos
              (2:1 aspect ratio — e.g. 4000×2000 px). Tools like Insta360, Theta,
              or Polycam can shoot these.
            </li>
            <li>
              For each panorama, click <strong>&quot;Mark as 360° panorama&quot;</strong> and
              give it a scene name (e.g. &quot;Entrance&quot;, &quot;Main Dining&quot;).
            </li>
            <li>
              Come back here. Pick a scene → click <strong>&quot;Add hotspot&quot;</strong> →
              click in the panorama to place it.
            </li>
            <li>
              Hotspot types:
              <ul className="list-disc pl-5 mt-1">
                <li><strong>Walk to another scene</strong> — connects scenes (one-way; add a return hotspot on the other side).</li>
                <li><strong>Book a table</strong> — links to a specific table from your floor plan.</li>
                <li><strong>External link</strong> — opens menu PDF, website, etc.</li>
                <li><strong>Info popup</strong> — shows a tooltip with extra info.</li>
              </ul>
            </li>
            <li>
              Mark one scene as the <strong>default</strong> (★) — that&apos;s where the tour starts.
            </li>
            <li>
              Share the public URL or embed code with customers — works on any website.
            </li>
          </ol>
        </details>

        {/* Public URL + embed */}
        {tour && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 grid sm:grid-cols-2 gap-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                Public URL
              </h3>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={publicUrl}
                  className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-xs font-mono bg-gray-50"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(publicUrl);
                    toast.success("URL copied");
                  }}
                  className="px-3 py-1.5 text-sm text-indigo-700 bg-indigo-100 rounded hover:bg-indigo-200"
                >
                  Copy
                </button>
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 text-sm text-gray-700 bg-gray-100 rounded hover:bg-gray-200 inline-flex items-center gap-1"
                >
                  <Icon icon="solar:external-link-bold" className="w-4 h-4" />
                  Open
                </a>
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                Embed on your website
              </h3>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={embedCode}
                  className="flex-1 rounded border border-gray-300 px-3 py-1.5 text-xs font-mono bg-gray-50"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(embedCode);
                    toast.success("Embed code copied");
                  }}
                  className="px-3 py-1.5 text-sm text-indigo-700 bg-indigo-100 rounded hover:bg-indigo-200"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Scenes overview with default toggle */}
        {tour && tour.scenes.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
              Scenes ({tour.scenes.length})
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {tour.scenes.map((s) => (
                <div
                  key={s.id}
                  className={`relative rounded-lg overflow-hidden border-2 ${
                    s.isDefaultScene ? "border-amber-400" : "border-gray-200"
                  }`}
                >
                  <img
                    src={s.publicUrl}
                    alt={s.sceneName || ""}
                    className="w-full h-24 object-cover"
                  />
                  <div className="p-2">
                    <div className="text-xs font-medium truncate">
                      {s.sceneName || "Untitled"}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
                      {s.hotspots.length} hotspot(s)
                    </div>
                  </div>
                  {s.isDefaultScene ? (
                    <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-amber-900">
                      ★ DEFAULT
                    </span>
                  ) : (
                    <button
                      onClick={() => handleSetDefault(s.id)}
                      className="absolute top-1 right-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/90 hover:bg-white text-gray-700 shadow"
                    >
                      Set default
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Editor */}
        {loadingTour ? (
          <div className="flex items-center justify-center py-20">
            <Icon icon="solar:refresh-bold" className="w-6 h-6 text-gray-400 animate-spin" />
          </div>
        ) : tour ? (
          <TourSceneEditor
            tenantId={tenantId}
            locationId={locationId!}
            scenes={tour.scenes}
            tables={tour.tables}
            onChanged={loadTour}
          />
        ) : null}
      </div>
    </div>
  );
}
