"use client";

// =============================================================================
// /supplier/terms — publish T&C versions + browse acceptance records.
//
// Two-panel layout:
//   Left: editor + version input + Publish button + live preview
//   Right: version history table (active badge + acceptance count)
// Below: acceptance log — one row per customer accept event, with IP + geo
// + timestamp so the supplier can hand this to legal on a chargeback.
//
// We deliberately don't parse the T&C body as markdown — it's rendered as
// whitespace-preserved plain text. Legal wants "the literal characters
// you saved" as the acceptance record; a markdown parser would sit between
// what the supplier typed and what the customer saw.
// =============================================================================

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { Button, Input } from "@/components/ui";

interface Version {
  id: string;
  version: string;
  bodyMarkdown: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  _count: { acceptances: number };
}

interface Acceptance {
  id: string;
  invoiceId: string | null;
  acceptedName: string;
  acceptedEmail: string;
  termsVersion: string;
  termsHash: string;
  ipAddress: string | null;
  geoCountry: string | null;
  geoRegion: string | null;
  geoCity: string | null;
  acceptedAt: string;
  invoice: {
    invoiceNumber: string;
    totalCents: number;
    currency: string;
  } | null;
}

const DEFAULT_STARTER = `# Terms and Conditions

Thank you for your business. By clicking "Pay" on this invoice, you agree to the following:

1. The amount shown is due immediately upon acceptance.
2. Software licences purchased are non-transferable and non-refundable once activated.
3. All support is provided on a best-effort basis during business hours.
4. Disputes will be resolved under the laws of the province of Ontario, Canada.

Contact: hello@your-company.example
`;

export default function SupplierTermsPage() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [acceptances, setAcceptances] = useState<Acceptance[]>([]);
  const [loading, setLoading] = useState(true);

  // Editor state — starts empty; if there's an active version the editor
  // pre-fills with its body so the supplier can iterate rather than rewrite.
  const [versionLabel, setVersionLabel] = useState("");
  const [body, setBody] = useState("");
  const [publishing, setPublishing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vRes, aRes] = await Promise.all([
        fetch("/api/supplier/terms"),
        fetch("/api/supplier/terms/acceptances"),
      ]);
      const vData = await vRes.json();
      const aData = await aRes.json();
      if (vData.success) {
        setVersions(vData.versions);
        // Pre-fill from active version (effective_to null) if present, else
        // give the supplier a starter template.
        const active = vData.versions.find((v: Version) => !v.effectiveTo);
        if (active && !body) {
          setBody(active.bodyMarkdown);
          setVersionLabel(nextVersionLabel(active.version));
        } else if (!body) {
          setBody(DEFAULT_STARTER);
          setVersionLabel("v1.0");
        }
      }
      if (aData.success) setAcceptances(aData.acceptances);
    } catch {
      toast.error("Failed to load T&C");
    } finally {
      setLoading(false);
    }
    // Deliberately excluding `body` from deps — we only want to seed the
    // editor once on first load, not overwrite what the supplier is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const publish = async () => {
    const label = versionLabel.trim();
    if (!label) {
      toast.error("Version label is required (e.g. v1.0, 2026-08-27)");
      return;
    }
    if (!body.trim()) {
      toast.error("T&C body cannot be empty");
      return;
    }
    if (
      versions.some((v) => v.bodyMarkdown === body && !v.effectiveTo) &&
      !confirm(
        "The body is identical to the currently active version. Publish a new version anyway?"
      )
    ) {
      return;
    }
    setPublishing(true);
    try {
      const res = await fetch("/api/supplier/terms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: label, bodyMarkdown: body }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to publish");
        return;
      }
      toast.success(`Version ${label} is now live`);
      setVersionLabel(nextVersionLabel(label));
      load();
    } catch {
      toast.error("Failed to publish");
    } finally {
      setPublishing(false);
    }
  };

  const loadVersionIntoEditor = (v: Version) => {
    setBody(v.bodyMarkdown);
    setVersionLabel(nextVersionLabel(v.version));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  const activeVersion = versions.find((v) => !v.effectiveTo);

  return (
    <div className="p-6 lg:p-10 max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
          Terms &amp; Conditions
        </h1>
        <p className="text-gray-500 mt-1 max-w-2xl">
          What your customers agree to when they pay an invoice. Publish a new
          version any time — old versions are preserved and every acceptance is
          stored with a snapshot of what the customer actually saw, plus their
          IP, geo, and timestamp. That's your chargeback defence.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Editor + preview */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
              {activeVersion ? "Publish a new version" : "Publish your first version"}
            </h2>
            {activeVersion && (
              <span className="text-xs text-gray-500">
                Currently active: <span className="font-mono font-medium text-teal-700">{activeVersion.version}</span>
              </span>
            )}
          </div>
          <div className="mb-4 max-w-xs">
            <Input
              label="Version label"
              placeholder="v1.0"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              helperText="Free-form. Common patterns: v1.0, 2026-08, 2026-Q3"
            />
          </div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">T&amp;C body</label>
          <textarea
            rows={16}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your terms here. Blank lines become paragraph breaks; the customer sees exactly what you type."
            className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none text-sm font-mono"
          />
          <p className="mt-2 text-xs text-gray-500">
            Plain text — no markdown, no HTML. What you type is what the customer sees and agrees to.
          </p>

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                if (activeVersion) {
                  setBody(activeVersion.bodyMarkdown);
                  setVersionLabel(nextVersionLabel(activeVersion.version));
                } else {
                  setBody(DEFAULT_STARTER);
                  setVersionLabel("v1.0");
                }
              }}
            >
              Reset editor
            </Button>
            <Button onClick={publish} disabled={publishing}>
              {publishing ? "Publishing…" : activeVersion ? "Publish new version" : "Publish"}
            </Button>
          </div>

          {/* Preview — same treatment as the pay page: preserved whitespace,
              body font. Matches what the customer will see. */}
          <div className="mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">
              Preview — as your customer will see it
            </p>
            <div className="rounded-xl border border-dashed border-gray-200 p-5 bg-gray-50 max-h-64 overflow-y-auto">
              {body.trim() ? (
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed m-0">
                  {body}
                </pre>
              ) : (
                <p className="text-sm text-gray-400 italic">Type above to see the preview</p>
              )}
            </div>
          </div>
        </div>

        {/* Version history */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-3">
            Version history
          </h2>
          {loading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-14 rounded-lg bg-gray-100" />
              <div className="h-14 rounded-lg bg-gray-100" />
            </div>
          ) : versions.length === 0 ? (
            <p className="text-sm text-gray-500">No versions published yet.</p>
          ) : (
            <ul className="space-y-2">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className="rounded-lg border border-gray-100 bg-gray-50 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-900">
                      {v.version}
                    </span>
                    {!v.effectiveTo ? (
                      <span className="inline-flex items-center rounded-full bg-teal-100 text-teal-800 px-2 py-0.5 text-[11px] font-medium">
                        Active
                      </span>
                    ) : (
                      <span className="text-[11px] text-gray-400">Archived</span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    Published {fmtDate(v.effectiveFrom)}
                    {v.effectiveTo && <> · retired {fmtDate(v.effectiveTo)}</>}
                  </p>
                  <div className="flex items-center justify-between mt-2 text-xs">
                    <span className="text-gray-600">
                      {v._count.acceptances} acceptance
                      {v._count.acceptances !== 1 ? "s" : ""}
                    </span>
                    <button
                      onClick={() => loadVersionIntoEditor(v)}
                      className="text-teal-700 hover:text-teal-800 font-medium"
                    >
                      Load in editor →
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Acceptance log */}
      <div className="rounded-2xl border border-gray-100 bg-white overflow-hidden">
        <div className="p-6 pb-3">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
            Acceptance log
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Every time a customer clicks Pay, we record it here with a snapshot
            of the version they saw. Present this to legal if a chargeback
            comes in.
          </p>
        </div>
        {loading ? (
          <div className="p-6 pt-0 space-y-2 animate-pulse">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 rounded-lg bg-gray-100" />
            ))}
          </div>
        ) : acceptances.length === 0 ? (
          <div className="px-6 pb-6 text-sm text-gray-500">
            No acceptances yet. Once a customer pays an invoice, their acceptance appears here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
                <tr>
                  <th className="text-left px-4 py-3">When</th>
                  <th className="text-left px-4 py-3">Customer</th>
                  <th className="text-left px-4 py-3">Invoice</th>
                  <th className="text-left px-4 py-3">Version</th>
                  <th className="text-left px-4 py-3">IP / Location</th>
                  <th className="text-left px-4 py-3">Hash</th>
                </tr>
              </thead>
              <tbody>
                {acceptances.map((a) => {
                  const loc = [a.geoCity, a.geoRegion, a.geoCountry]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <tr key={a.id} className="border-t border-gray-100">
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{fmtDate(a.acceptedAt)}</td>
                      <td className="px-4 py-3">
                        <p className="text-gray-900">{a.acceptedName}</p>
                        <p className="text-xs text-gray-500">{a.acceptedEmail}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-700">
                        {a.invoice?.invoiceNumber ?? "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-teal-800">
                        {a.termsVersion}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <p className="font-mono text-gray-700">{a.ipAddress || "—"}</p>
                        {loc && <p className="text-gray-500">{loc}</p>}
                      </td>
                      <td className="px-4 py-3 font-mono text-[10px] text-gray-400 max-w-[140px] truncate" title={a.termsHash}>
                        {a.termsHash}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Best-effort "next version" suggestion — bumps v1.0 → v1.1, v2 → v3,
// 2026-08 → 2026-09, else appends "-2" so at minimum it's different.
function nextVersionLabel(current: string): string {
  const semver = current.match(/^(v?)(\d+)\.(\d+)$/i);
  if (semver) return `${semver[1]}${semver[2]}.${Number(semver[3]) + 1}`;
  const majorOnly = current.match(/^(v?)(\d+)$/i);
  if (majorOnly) return `${majorOnly[1]}${Number(majorOnly[2]) + 1}`;
  const yearMonth = current.match(/^(\d{4})-(\d{2})$/);
  if (yearMonth) {
    const y = Number(yearMonth[1]);
    const m = Number(yearMonth[2]);
    if (m < 12) return `${y}-${String(m + 1).padStart(2, "0")}`;
    return `${y + 1}-01`;
  }
  return `${current}-2`;
}
