"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Select, Card, Badge, Modal, Toggle } from "@/components/ui";

interface Terminal {
  id: string;
  locationId: string;
  name: string;
  // Phase Moneris-UI (2026-08-30): MONERIS added as a first-class provider.
  // MONERIS terminals reach Moneris Go cloud via their Device ID (stored
  // in serial_number), not a lane. Credentials live on the tenant's
  // Moneris payment-provider row in tapapp-admin.
  provider: "UCI" | "UPA" | "MONERIS";
  uciLane?: string | null;
  uciMerchantId?: string | null;
  uciEnvironment?: "CERT" | "PROD" | null;
  ipAddress?: string | null;
  port?: number | null;
  serialNumber?: string | null; // MONERIS Device ID (e.g. "A7005622")
  model?: string | null;        // e.g. "DX8000"
  status: "ONLINE" | "OFFLINE" | "BUSY" | "ERROR";
  isDefault: boolean;
  lastPingAt?: string | null;
  location?: { id: string; name: string };
}

type ProviderChoice = "UCI" | "MONERIS";

interface Location {
  id: string;
  name: string;
}

export default function TerminalsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Terminal | null>(null);

  const [formData, setFormData] = useState({
    locationId: "",
    name: "",
    // Provider dropdown default. Moneris is per-store — credentials are
    // in tapapp-admin, this form only records the physical device.
    provider: "UCI" as ProviderChoice,
    uciLane: "",
    uciMerchantId: "",
    uciEnvironment: "CERT" as "CERT" | "PROD",
    // Moneris-only: Device ID + model.
    serialNumber: "",
    model: "DX8000",
    isDefault: false,
  });

  // Setup-instructions modal
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [setupTerminal, setSetupTerminal] = useState<Terminal | null>(null);

  // Per-terminal test state
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    terminalId: string;
    ok: boolean;
    title: string;
    body: string;
  } | null>(null);

  // Batch-close state — keyed by terminalId so the spinner shows on the
  // right card and the result lands inline on the same card.
  const [batchClosingId, setBatchClosingId] = useState<string | null>(null);

  const runBatchClose = async (terminal: Terminal) => {
    if (
      !confirm(
        `Close the batch on "${terminal.name}"? This settles all approved transactions on this terminal for the day. The action cannot be undone.`
      )
    ) {
      return;
    }
    setBatchClosingId(terminal.id);
    setTestResult(null);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/payments/uci/batch-close`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ terminalId: terminal.id }),
        }
      );
      const data = await res.json();
      if (res.ok && data.success) {
        const lines = [
          `BATCH_CLOSE accepted on ${terminal.name}.`,
          data.dvcId && `DVC: ${data.dvcId}`,
          `Terminal should print the settlement summary.`,
        ].filter(Boolean);
        setTestResult({
          terminalId: terminal.id,
          ok: true,
          title: "Batch closed",
          body: lines.join("\n"),
        });
        toast.success("Batch closed");
      } else {
        setTestResult({
          terminalId: terminal.id,
          ok: false,
          title: "Batch close failed",
          body: data.error || `HTTP ${res.status}`,
        });
        toast.error(data.error || "Batch close failed");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setTestResult({
        terminalId: terminal.id,
        ok: false,
        title: "Batch close failed",
        body: msg,
      });
      toast.error("Batch close failed");
    } finally {
      setBatchClosingId(null);
    }
  };

  const runTerminalTest = async (
    terminal: Terminal,
    action: "ping" | "test_bill",
    amount?: number
  ) => {
    setTestingId(terminal.id);
    setTestResult(null);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/terminals/${terminal.id}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, amount }),
        }
      );
      const data = await res.json();
      if (data.success) {
        const lines = [
          `Status: ${data.status || "OK"}`,
          data.dvcId && `DVC: ${data.dvcId}`,
          data.actionResult?.result_code &&
            `Result: ${data.actionResult.result_code}`,
          data.hint,
        ].filter(Boolean) as string[];
        setTestResult({
          terminalId: terminal.id,
          ok: true,
          title: action === "ping" ? "Ping succeeded" : `Test bill sent ($${(amount! / 100).toFixed(2)})`,
          body: lines.join("\n"),
        });
        toast.success(action === "ping" ? "Ping OK" : "Bill sent to terminal");
      } else {
        setTestResult({
          terminalId: terminal.id,
          ok: false,
          title: action === "ping" ? "Ping failed" : "Test bill failed",
          body: `${data.error || "Unknown error"}${
            data.errorCode ? `\nGP error code: ${data.errorCode}` : ""
          }`,
        });
        toast.error(data.error || "Test failed");
      }
    } catch (err: any) {
      setTestResult({
        terminalId: terminal.id,
        ok: false,
        title: "Network error",
        body: err?.message || "Could not reach the test endpoint",
      });
      toast.error("Test failed");
    } finally {
      setTestingId(null);
    }
  };

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;
    try {
      const [termsRes, locsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/terminals`),
        fetch(`/api/tenants/${tenantId}/locations`),
      ]);
      const termsData = await termsRes.json();
      const locsData = await locsRes.json();
      if (termsData.terminals) setTerminals(termsData.terminals);
      if (locsData.success) setLocations(locsData.locations);
      if (locsData.success && locsData.locations.length > 0 && !formData.locationId) {
        setFormData((f) => ({ ...f, locationId: locsData.locations[0].id }));
      }
    } catch {
      toast.error("Failed to load terminals");
    } finally {
      setLoading(false);
    }
  }, [tenantId, formData.locationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openAddModal = () => {
    setEditing(null);
    setFormData({
      locationId: locations[0]?.id || "",
      name: "",
      provider: "UCI",
      uciLane: "",
      uciMerchantId: "",
      uciEnvironment: "CERT",
      serialNumber: "",
      model: "DX8000",
      isDefault: terminals.length === 0,
    });
    setShowModal(true);
  };

  const openEditModal = (t: Terminal) => {
    setEditing(t);
    setFormData({
      locationId: t.locationId,
      name: t.name,
      provider: t.provider === "MONERIS" ? "MONERIS" : "UCI",
      uciLane: t.uciLane || "",
      uciMerchantId: t.uciMerchantId || "",
      uciEnvironment: (t.uciEnvironment as "CERT" | "PROD") || "CERT",
      serialNumber: t.serialNumber || "",
      model: t.model || "DX8000",
      isDefault: t.isDefault,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.locationId || !formData.name.trim()) {
      toast.error("Location and name are required");
      return;
    }
    if (formData.provider === "UCI" && !formData.uciLane.trim()) {
      toast.error("Lane / TID is required for a UCI terminal");
      return;
    }
    if (formData.provider === "MONERIS" && !formData.serialNumber.trim()) {
      toast.error("Device ID is required for a Moneris terminal");
      return;
    }

    const url = editing
      ? `/api/tenants/${tenantId}/terminals/${editing.id}`
      : `/api/tenants/${tenantId}/terminals`;

    const payload =
      formData.provider === "MONERIS"
        ? {
            locationId: formData.locationId,
            name: formData.name.trim(),
            provider: "MONERIS",
            model: formData.model.trim() || "DX8000",
            serialNumber: formData.serialNumber.trim(),
            isDefault: formData.isDefault,
            // Nulls for UCI fields so the row doesn't inherit stale values
            // if a UCI terminal is switched to MONERIS on edit.
            uciLane: null,
            uciMerchantId: null,
            uciEnvironment: null,
          }
        : {
            locationId: formData.locationId,
            name: formData.name.trim(),
            provider: "UCI",
            uciLane: formData.uciLane.trim(),
            uciMerchantId: formData.uciMerchantId.trim() || null,
            uciEnvironment: formData.uciEnvironment,
            isDefault: formData.isDefault,
          };

    try {
      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(editing ? "Terminal updated" : "Terminal added");
        setShowModal(false);
        loadData();
      } else {
        toast.error(data.error || "Failed to save terminal");
      }
    } catch {
      toast.error("Failed to save terminal");
    }
  };

  const handleDelete = async (t: Terminal) => {
    if (!confirm(`Delete terminal "${t.name}"?`)) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/terminals/${t.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Terminal deleted");
        loadData();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to delete");
      }
    } catch {
      toast.error("Failed to delete");
    }
  };

  if (!tenantId) {
    return (
      <div className="p-12 text-center">
        <p className="text-gray-500">Please select a business first</p>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Payment Terminals"
        subtitle="Cloud-connected terminals — Global Payments UCI or Moneris Go. No VPN or local network setup needed."
        actions={
          <Button icon="solar:add-circle-bold" onClick={openAddModal}>
            Add Terminal
          </Button>
        }
      />

      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* How it works banner — covers both providers now. */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 border border-indigo-100">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0">
              <Icon icon="solar:card-transfer-bold" className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">How terminals work</h3>
              <p className="text-sm text-gray-700 mb-2">
                Each terminal opens a persistent connection to its processor&apos;s cloud — no VPN,
                no port-forwarding, no local network configuration. Pick your processor when you
                add a terminal:
              </p>
              <ul className="text-sm text-gray-700 space-y-1.5 mb-2">
                <li>
                  <strong>Global Payments (UCI)</strong> — Verifone T650 / similar → install UCI
                  Android app → set Cloud URL + <strong>Processing TID (Lane)</strong>, then add
                  it here using that Lane (e.g. <code className="bg-white px-1.5 py-0.5 rounded text-xs">OREUGO01</code>).
                </li>
                <li>
                  <strong>Moneris Go</strong> — Moneris DX8000 → boot the terminal, sign into the
                  Moneris Go app with your merchant credentials, then add the terminal here using
                  its <strong>Device ID</strong> (e.g. <code className="bg-white px-1.5 py-0.5 rounded text-xs">A7005622</code>).
                  Store ID and API token live in the tapapp-admin Payment Providers tab.
                </li>
              </ul>
              <p className="text-sm text-gray-700">
                In the POS, staff picks &quot;Pay with Terminal&quot; → customer taps card on the
                device → result flows back automatically.
              </p>
            </div>
          </div>
        </div>

        {/* Terminal list */}
        {loading ? (
          <Card>
            <div className="animate-pulse space-y-4">
              <div className="h-20 bg-gray-100 rounded" />
              <div className="h-20 bg-gray-100 rounded" />
            </div>
          </Card>
        ) : terminals.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:card-transfer-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No terminals registered yet</h3>
            <p className="text-gray-500 mb-6">
              Add your first payment terminal to start accepting card payments
            </p>
            <Button icon="solar:add-circle-bold" onClick={openAddModal}>
              Add First Terminal
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {terminals.map((t) => (
              <Card key={t.id} className="relative">
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      t.status === "ONLINE"
                        ? "bg-gradient-to-br from-green-500 to-emerald-600"
                        : t.status === "BUSY"
                        ? "bg-gradient-to-br from-amber-500 to-orange-600"
                        : "bg-gradient-to-br from-gray-400 to-gray-500"
                    }`}
                  >
                    <Icon icon="solar:card-transfer-bold" className="w-6 h-6 text-white" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-gray-900 truncate">{t.name}</h3>
                      {t.isDefault && <Badge variant="info" size="sm">Default</Badge>}
                      {t.provider === "UCI" ? (
                        <Badge variant="success" size="sm">UCI · {t.uciEnvironment}</Badge>
                      ) : t.provider === "MONERIS" ? (
                        <Badge variant="info" size="sm">
                          Moneris{t.model ? ` · ${t.model}` : ""}
                        </Badge>
                      ) : (
                        <Badge variant="warning" size="sm">Legacy UPA</Badge>
                      )}
                    </div>

                    <div className="mt-2 space-y-1 text-sm text-gray-500">
                      {t.location && (
                        <div className="flex items-center gap-1.5">
                          <Icon icon="solar:map-point-bold" className="w-3.5 h-3.5" />
                          {t.location.name}
                        </div>
                      )}
                      {t.provider === "UCI" && t.uciLane && (
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <Icon icon="solar:tag-bold" className="w-3.5 h-3.5" />
                          Lane: <span className="text-gray-900 font-semibold">{t.uciLane}</span>
                        </div>
                      )}
                      {t.provider === "MONERIS" && t.serialNumber && (
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <Icon icon="solar:tag-bold" className="w-3.5 h-3.5" />
                          Device ID: <span className="text-gray-900 font-semibold">{t.serialNumber}</span>
                        </div>
                      )}
                      {t.provider === "UPA" && t.ipAddress && (
                        <div className="flex items-center gap-1.5 font-mono text-xs">
                          <Icon icon="solar:server-bold" className="w-3.5 h-3.5" />
                          {t.ipAddress}:{t.port}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100 flex-wrap">
                  {t.provider === "MONERIS" && (
                    <div className="w-full mb-2 text-xs text-gray-500 flex items-start gap-1.5">
                      <Icon icon="solar:info-circle-linear" className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-indigo-500" />
                      <span>
                        Moneris credentials (Store ID + API token) live in
                        <strong className="text-gray-700"> tapapp-admin → Tenants → Payment Providers</strong>.
                        Ping &amp; test bill from this page are coming next — for now, test from the POS.
                      </span>
                    </div>
                  )}
                  {t.provider === "UCI" && (
                    <>
                      <button
                        onClick={() => runTerminalTest(t, "ping")}
                        disabled={testingId === t.id}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-medium hover:bg-emerald-100 disabled:opacity-50"
                        title="Send a PING to verify the terminal is reachable"
                      >
                        <Icon
                          icon={testingId === t.id ? "solar:refresh-bold" : "solar:radar-2-bold"}
                          className={`w-4 h-4 ${testingId === t.id ? "animate-spin" : ""}`}
                        />
                        Ping
                      </button>
                      <button
                        onClick={() => runTerminalTest(t, "test_bill", 100)}
                        disabled={testingId === t.id}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium hover:bg-amber-100 disabled:opacity-50"
                        title="Push a $1.00 test bill to this terminal"
                      >
                        <Icon icon="solar:test-tube-bold" className="w-4 h-4" />
                        Test Bill ($1)
                      </button>
                      <button
                        onClick={() => runBatchClose(t)}
                        disabled={batchClosingId === t.id}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 disabled:opacity-50"
                        title="End-of-day settlement — closes today's batch on this terminal"
                      >
                        <Icon
                          icon={
                            batchClosingId === t.id
                              ? "solar:refresh-bold"
                              : "solar:calendar-minimalistic-bold"
                          }
                          className={`w-4 h-4 ${batchClosingId === t.id ? "animate-spin" : ""}`}
                        />
                        Close Batch
                      </button>
                      <button
                        onClick={() => {
                          setSetupTerminal(t);
                          setShowSetupModal(true);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100"
                      >
                        <Icon icon="solar:settings-bold" className="w-4 h-4" />
                        Setup
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => openEditModal(t)}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200"
                  >
                    <Icon icon="solar:pen-linear" className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(t)}
                    className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                    title="Delete"
                  >
                    <Icon icon="solar:trash-bin-trash-linear" className="w-5 h-5" />
                  </button>
                </div>

                {/* Inline test result */}
                {testResult?.terminalId === t.id && (
                  <div
                    className={`mt-3 p-3 rounded-xl text-sm whitespace-pre-line ${
                      testResult.ok
                        ? "bg-emerald-50 border border-emerald-200 text-emerald-900"
                        : "bg-red-50 border border-red-200 text-red-900"
                    }`}
                  >
                    <div className="font-semibold mb-1">{testResult.title}</div>
                    <div className="text-xs font-mono opacity-90">{testResult.body}</div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add / Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={
          editing
            ? "Edit Terminal"
            : formData.provider === "MONERIS"
            ? "Add Moneris Terminal"
            : "Add UCI Terminal"
        }
        size="sm"
      >
        <div className="space-y-4">
          {/* Provider picker — locked on edit so we can't switch a live
              terminal's processor by accident. */}
          <Select
            label="Processor"
            options={[
              { value: "UCI", label: "Global Payments (UCI)" },
              { value: "MONERIS", label: "Moneris Go (DX8000)" },
            ]}
            value={formData.provider}
            onChange={(e) =>
              setFormData({ ...formData, provider: e.target.value as ProviderChoice })
            }
            disabled={!!editing}
          />

          {formData.provider === "UCI" ? (
            <div className="p-3 bg-indigo-50 rounded-xl text-xs text-indigo-800">
              <Icon icon="solar:info-circle-bold" className="w-4 h-4 inline mr-1.5" />
              Enter the <strong>Processing TID (Lane)</strong> shown in the terminal&apos;s
              UCI Android app under Merchant Settings. This is how we route bills to
              the right device.
            </div>
          ) : (
            <div className="p-3 bg-blue-50 rounded-xl text-xs text-blue-800">
              <Icon icon="solar:info-circle-bold" className="w-4 h-4 inline mr-1.5" />
              Enter the <strong>Device ID</strong> (e.g. <code className="font-mono">A7005622</code>)
              shown on the DX8000 or in the Moneris Go portal → Devices. Store ID +
              API token stay in tapapp-admin.
            </div>
          )}

          <Select
            label="Location"
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
            value={formData.locationId}
            onChange={(e) => setFormData({ ...formData, locationId: e.target.value })}
            required
            disabled={!!editing}
          />

          <Input
            label="Friendly Name"
            placeholder={
              formData.provider === "MONERIS"
                ? "e.g. Front Counter, Bar Terminal"
                : "e.g. Counter 1, Drive-Thru, Booth 5"
            }
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />

          {formData.provider === "UCI" ? (
            <>
              <Input
                label="Processing TID / Lane"
                placeholder="e.g. OREUGO01"
                value={formData.uciLane}
                onChange={(e) => setFormData({ ...formData, uciLane: e.target.value })}
                helperText="Shown in the terminal's UCI app under 'Select Lane (Processing TID)'"
                required
              />
              <Input
                label="Merchant / Location ID (optional)"
                placeholder="e.g. 82428418230"
                value={formData.uciMerchantId}
                onChange={(e) => setFormData({ ...formData, uciMerchantId: e.target.value })}
                helperText="GP Location ID — leave blank to use tenant default"
              />
              <Select
                label="Environment"
                options={[
                  { value: "CERT", label: "Certification (testing)" },
                  { value: "PROD", label: "Production (live)" },
                ]}
                value={formData.uciEnvironment}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    uciEnvironment: e.target.value as "CERT" | "PROD",
                  })
                }
              />
            </>
          ) : (
            <>
              <Input
                label="Device ID"
                placeholder="e.g. A7005622"
                value={formData.serialNumber}
                onChange={(e) => setFormData({ ...formData, serialNumber: e.target.value })}
                helperText="The Device ID / serial from the DX8000. Must match what's in tapapp-admin → Payment Providers → Moneris → terminal_id."
                required
              />
              <Input
                label="Model"
                placeholder="DX8000"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                helperText="Just for display — e.g. DX8000, Core, Kount"
              />
            </>
          )}

          <Toggle
            label="Default Terminal"
            description="POS picks this terminal automatically when staff taps 'Pay with Terminal'"
            checked={formData.isDefault}
            onChange={(checked) => setFormData({ ...formData, isDefault: checked })}
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editing ? "Save Changes" : "Add Terminal"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Terminal Setup Guide Modal — shows exact values to type into the physical device */}
      <Modal
        isOpen={showSetupModal}
        onClose={() => setShowSetupModal(false)}
        title={setupTerminal ? `Setup: ${setupTerminal.name}` : "Terminal Setup"}
        size="md"
      >
        {setupTerminal && (
          <SetupGuideContent terminal={setupTerminal} />
        )}
      </Modal>
    </div>
  );
}

// ---------- Setup Guide Modal Content ----------

function SetupGuideContent({ terminal }: { terminal: Terminal }) {
  const isProd = terminal.uciEnvironment === "PROD";

  const cloudUrl = isProd
    ? "wss://wss.paygateway.com/mic"
    : "wss://wss.test.paygateway.com/mic";
  const billUrl = isProd
    ? "https://apis.globalpay.com"
    : "https://apis-cert.globalpay.com";

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied!`);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const Row = ({
    label,
    value,
    mono = true,
  }: {
    label: string;
    value: string;
    mono?: boolean;
  }) => (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-0.5">
          {label}
        </p>
        <p className={`text-sm text-gray-900 truncate ${mono ? "font-mono" : ""}`}>
          {value || <span className="italic text-gray-400">not set</span>}
        </p>
      </div>
      {value && (
        <button
          onClick={() => copy(value, label)}
          className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 flex-shrink-0"
          title="Copy"
        >
          <Icon icon="solar:copy-bold" className="w-4 h-4" />
        </button>
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Environment banner */}
      <div
        className={`p-4 rounded-2xl flex items-center gap-3 ${
          isProd
            ? "bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200"
            : "bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200"
        }`}
      >
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            isProd ? "bg-emerald-500" : "bg-amber-500"
          }`}
        >
          <Icon
            icon={isProd ? "solar:check-circle-bold" : "solar:test-tube-bold"}
            className="w-5 h-5 text-white"
          />
        </div>
        <div>
          <p className={`font-semibold ${isProd ? "text-emerald-900" : "text-amber-900"}`}>
            {isProd ? "Production environment" : "Certification (test) environment"}
          </p>
          <p className={`text-xs ${isProd ? "text-emerald-700" : "text-amber-700"}`}>
            {isProd
              ? "Real card transactions will process."
              : "Safe for testing — use test cards only."}
          </p>
        </div>
      </div>

      {/* Step 1: Install & open */}
      <div>
        <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">
            1
          </span>
          Install & open the UCI app
        </h4>
        <p className="text-sm text-gray-600 ml-8">
          On the Verifone T650 (or other UCI-compatible terminal), open the{" "}
          <strong>Unified Cloud Integrations</strong> Android app. First time you&apos;ll see a
          welcome screen — tap <strong>Continue</strong>.
        </p>
      </div>

      {/* Step 2: Enter these values */}
      <div>
        <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">
            2
          </span>
          Type these values on the terminal
        </h4>

        <div className="ml-8 space-y-3 p-4 bg-gray-50 rounded-2xl border border-gray-100">
          <Row label="Cloud URL" value={cloudUrl} />
          <div className="h-px bg-gray-200" />
          <Row
            label="Location ID"
            value={terminal.uciMerchantId || "(not set — add it under Edit)"}
            mono={!!terminal.uciMerchantId}
          />
          <div className="h-px bg-gray-200" />
          <Row label="Select Lane (Processing TID)" value={terminal.uciLane || ""} />
          <div className="h-px bg-gray-200" />
          <Row label="Bill URL" value={billUrl} />
        </div>
      </div>

      {/* Step 3: Admin password */}
      <div>
        <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">
            3
          </span>
          Admin password
        </h4>
        <p className="text-sm text-gray-600 ml-8">
          The default admin password for Merchant Settings is{" "}
          <code className="bg-gray-100 px-2 py-0.5 rounded font-mono text-xs">25683Nine</code>.
          Change it immediately via{" "}
          <strong>Merchant Settings → Change Password</strong> (min 7 chars, 1 number, 1 upper,
          1 lower).
        </p>
      </div>

      {/* Step 4: Confirm */}
      <div>
        <h4 className="font-semibold text-gray-900 mb-2 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold">
            4
          </span>
          Tap <span className="px-2 py-0.5 rounded bg-blue-600 text-white text-xs font-semibold">Confirm</span>
        </h4>
        <p className="text-sm text-gray-600 ml-8">
          The terminal will connect to Global Payments&apos; cloud and show the Welcome screen.
          When the POS pushes a bill to Lane{" "}
          <code className="bg-gray-100 px-1.5 rounded font-mono text-xs">
            {terminal.uciLane || "???"}
          </code>
          , it&apos;ll appear here for the customer to pay.
        </p>
      </div>

      {/* Tips */}
      <div className="p-3 bg-indigo-50 rounded-xl text-xs text-indigo-900 space-y-1.5">
        <p className="flex items-start gap-2">
          <Icon icon="solar:lightbulb-bold" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Stuck in the app?</strong> Forgotten the admin password → Android Settings →
            Apps → UCI → Clear Cache → app resets to first-install state.
          </span>
        </p>
        <p className="flex items-start gap-2">
          <Icon icon="solar:refresh-bold" className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            <strong>Bill home screen idle for 3 min?</strong> Tap{" "}
            <em>Refresh</em> — Verifone T650 auto-refreshes on motion.
          </span>
        </p>
      </div>
    </div>
  );
}
