"use client";

// ============================================================================
// /tour/[slug]   — public, embeddable virtual tour page
//
// Standalone page (no auth, no admin chrome). Works both:
//   - Direct visit: shows tour with restaurant name header
//   - Iframe embed (?embed=1): hides header, shows tour only
//
// When customer clicks a TABLE_LINK hotspot, we redirect them to the
// reservation flow (placeholder for now — Phase 6 builds it out).
// ============================================================================

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Icon } from "@iconify/react";
import VirtualTourViewer from "@/components/virtual-tour/VirtualTourViewer";
import type { PublicTourPayload, TourTable } from "@/lib/virtual-tour/types";

export default function PublicTourPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <PublicTourPageInner />
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <Icon icon="solar:refresh-bold" className="w-6 h-6 animate-spin" />
    </div>
  );
}

function PublicTourPageInner() {
  const params = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const embed = searchParams.get("embed") === "1";

  const [data, setData] = useState<PublicTourPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!params.slug) return;
    setLoading(true);
    setError(null);
    fetch(`/api/public/tour/${params.slug}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((payload) => setData(payload))
      .catch((err) => setError(err?.message || "Failed to load tour"))
      .finally(() => setLoading(false));
  }, [params.slug]);

  const handleTableSelect = (tableId: string, table: TourTable | undefined) => {
    // Phase 6 will implement the actual booking flow. For now:
    //   - If embedded: postMessage to parent so the embedding page can react
    //   - Direct visit: navigate to reservation page with table pre-selected
    if (embed && typeof window !== "undefined") {
      window.parent.postMessage(
        {
          type: "oreugo:tour:table-selected",
          tableId,
          tableNumber: table?.tableNumber,
          tableLabel: table?.displayLabel,
        },
        "*"
      );
    } else {
      // Direct visit — eventually goes to /book/<slug>?table=<id>
      // For now, alert until Phase 6 ships the reservation page
      alert(
        `You selected table ${table?.tableNumber || tableId}. Reservation flow ships in Phase 6.`
      );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <Icon icon="solar:refresh-bold" className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-6">
        <div className="text-center">
          <Icon icon="solar:danger-triangle-bold" className="w-12 h-12 mx-auto text-amber-400 mb-3" />
          <h1 className="text-xl font-bold mb-2">Tour unavailable</h1>
          <p className="text-sm text-gray-400">{error || "Not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${embed ? "" : "min-h-screen bg-gray-900 text-white"} relative`}>
      {/* Header — hidden when embedded */}
      {!embed && (
        <header className="px-4 sm:px-6 py-3 border-b border-white/10 bg-black/40 backdrop-blur">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold">{data.location.name}</h1>
              <p className="text-xs text-white/60">{data.location.tenantName}</p>
            </div>
            <div className="text-xs text-white/40 flex items-center gap-2">
              <Icon icon="solar:vr-bold" className="w-4 h-4" />
              Virtual Tour
            </div>
          </div>
        </header>
      )}

      {/* Tour viewer */}
      <main className={embed ? "" : "p-2 sm:p-4 max-w-6xl mx-auto"}>
        <VirtualTourViewer
          scenes={data.scenes}
          tables={data.tables}
          onTableSelect={handleTableSelect}
          height={embed ? "100vh" : "70vh"}
        />
      </main>

      {/* Footer — hidden when embedded */}
      {!embed && (
        <footer className="text-center text-xs text-white/40 py-4">
          Powered by Oreugo
        </footer>
      )}
    </div>
  );
}
