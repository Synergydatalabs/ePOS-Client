// The wizard shell — owns step navigation, application state, and the
// bootstrap fetch. Each step is its own file; this component wires them
// to the API + progress bar.
//
// Editing rules:
//   - DRAFT / INFO_REQUESTED  → all steps interactive
//   - anything else           → read-only (Step 5 shows the current status
//                                and hides the sign block)
//
// State model: a single WizardApplication object lives in state. Each
// step calls saveStep(patch) to PATCH the row, then the wizard replaces
// the object with the server's canonical version. We deliberately DON'T
// keep per-step drafts client-side — the DB is the source of truth so
// refreshing the tab never loses work.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import Step1Business from "./Step1Business";
import Step2Financials from "./Step2Financials";
import Step3Ubos from "./Step3Ubos";
import Step4Documents from "./Step4Documents";
import Step5Review from "./Step5Review";
import type { WizardApplication } from "./types";

const STEP_LABELS = ["Business", "Financials", "Owners", "Documents", "Review & sign"];

interface Props {
  tenantId: string;
  tenantCurrency: string;
  role: string;
}

export default function OnboardingWizard({ tenantId, tenantCurrency }: Props) {
  const [application, setApplication] = useState<WizardApplication | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [savingStep, setSavingStep] = useState(false);
  const [step, setStep] = useState(0);

  // --- Bootstrap: fetch existing application (if any) ---
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/onboarding/application`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `Load failed (${res.status})`);
      }
      const data = await res.json();
      setApplication(data.application ?? null);
    } catch (e) {
      toast.error((e as Error).message || "Failed to load application");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  // Create a fresh DRAFT — called from Step 1's first Save when the tenant
  // hasn't started yet. Idempotent: server rejects a second in-flight
  // create with 409 and returns the existing id.
  const createDraft = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/onboarding/application`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create draft");
      setApplication(data.application);
      return data.application as WizardApplication;
    } finally {
      setCreating(false);
    }
  }, [tenantId]);

  // Save a partial to the DRAFT. Creates one if the tenant doesn't have
  // one yet. Returns the fresh application so caller can chain.
  const saveStep = useCallback(
    async (patch: Record<string, unknown>) => {
      setSavingStep(true);
      try {
        let app = application;
        if (!app) app = await createDraft();

        const res = await fetch(`/api/tenants/${tenantId}/onboarding/application`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationId: app.id, ...patch }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
        setApplication(data.application);
        return data.application as WizardApplication;
      } catch (e) {
        toast.error((e as Error).message || "Failed to save step");
        throw e;
      } finally {
        setSavingStep(false);
      }
    },
    [application, createDraft, tenantId]
  );

  // Fired by UBO / documents children so the wizard mirrors DB state
  // without a full reload of every field.
  const refetch = useCallback(async () => {
    await load();
  }, [load]);

  const isReadOnly = useMemo(() => {
    if (!application) return false;
    return application.status !== "DRAFT" && application.status !== "INFO_REQUESTED";
  }, [application]);

  // --- Render ---

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-100 rounded w-1/3" />
        <div className="h-64 bg-gray-100 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isReadOnly && application && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-3">
          <Icon icon="solar:lock-keyhole-bold" className="w-5 h-5 mt-0.5" />
          <div>
            <p className="font-semibold">
              Application is {application.status.replaceAll("_", " ").toLowerCase()} — read-only.
            </p>
            <p className="mt-1 text-amber-900/80">
              An admin needs to move it back to <strong>INFO_REQUESTED</strong> if you need to change
              anything.
            </p>
          </div>
        </div>
      )}

      <Progress step={step} total={STEP_LABELS.length} labels={STEP_LABELS} onJump={setStep} />

      <div className="rounded-2xl border border-gray-200 bg-white p-5 lg:p-6">
        {step === 0 && (
          <Step1Business
            application={application}
            readOnly={isReadOnly}
            saving={savingStep || creating}
            onSave={async (patch) => {
              await saveStep(patch);
            }}
            onNext={() => setStep(1)}
          />
        )}
        {step === 1 && (
          <Step2Financials
            application={application}
            readOnly={isReadOnly}
            saving={savingStep || creating}
            tenantCurrency={tenantCurrency}
            onSave={async (patch) => {
              await saveStep(patch);
            }}
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <Step3Ubos
            application={application}
            tenantId={tenantId}
            readOnly={isReadOnly}
            onChange={refetch}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <Step4Documents
            application={application}
            tenantId={tenantId}
            readOnly={isReadOnly}
            onChange={refetch}
            onBack={() => setStep(2)}
            onNext={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <Step5Review
            application={application}
            tenantId={tenantId}
            readOnly={isReadOnly}
            onEditStep={(i) => setStep(i)}
            onSubmitted={refetch}
          />
        )}
      </div>
    </div>
  );
}

function Progress({
  step,
  total,
  labels,
  onJump,
}: {
  step: number;
  total: number;
  labels: string[];
  onJump: (idx: number) => void;
}) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {labels.map((label, i) => {
          const active = i === step;
          const done = i < step;
          return (
            <button
              key={label}
              type="button"
              onClick={() => onJump(i)}
              className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : done
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              <span
                className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  active
                    ? "bg-white/20 text-white"
                    : done
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              {label}
            </button>
          );
        })}
      </div>
      <div className="mt-3 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all"
          style={{ width: `${((step + 1) / total) * 100}%` }}
        />
      </div>
    </div>
  );
}
