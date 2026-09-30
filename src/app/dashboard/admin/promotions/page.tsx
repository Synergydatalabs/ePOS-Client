"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Modal } from "@/components/ui";
import { toast } from "sonner";

interface Promotion {
  id: string;
  name: string;
  code?: string | null;
  isActive: boolean;
  discountType: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_ITEM" | "BOGO";
  discountValue: number;
  maxDiscount?: number | null;
  minCartValue?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  activeStartTime?: string | null;
  activeEndTime?: string | null;
  activeDays: number[];
  usageLimit?: number | null;
  usageCount: number;
  createdAt: string;
}

export default function PromotionsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [items, setItems] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/promotions`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);
      const [pData, sData] = await Promise.all([pRes.json(), sRes.json()]);
      if (pData.success) setItems(pData.promotions);
      if (sData.success) setCurrency(sData.tenant?.currency || "CAD");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const formatPrice = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(
      (cents || 0) / 100
    );

  const formatDiscount = (p: Promotion) => {
    if (p.discountType === "PERCENTAGE") return `${p.discountValue}% off`;
    if (p.discountType === "FIXED_AMOUNT")
      return `${formatPrice(p.discountValue)} off`;
    return p.discountType;
  };

  const deletePromo = async (p: Promotion) => {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    const res = await fetch(
      `/api/tenants/${tenantId}/promotions/${p.id}`,
      { method: "DELETE" }
    );
    if (res.ok) {
      toast.success("Deleted");
      load();
    } else {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error || "Delete failed");
    }
  };

  const toggleActive = async (p: Promotion) => {
    const res = await fetch(
      `/api/tenants/${tenantId}/promotions/${p.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !p.isActive }),
      }
    );
    if (res.ok) {
      toast.success(p.isActive ? "Deactivated" : "Activated");
      load();
    }
  };

  return (
    <div>
      <AdminHeader
        title="Promotions"
        subtitle="Create promo codes and automatic discounts"
      />

      <div className="p-6 space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Icon icon="solar:add-circle-bold" className="w-4 h-4 mr-2" />
            New Promotion
          </Button>
        </div>

        <div className="card overflow-hidden">
          {loading ? (
            <Loading />
          ) : items.length === 0 ? (
            <Empty />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Name</th>
                    <th className="text-left px-4 py-3 font-medium">Code</th>
                    <th className="text-left px-4 py-3 font-medium">Discount</th>
                    <th className="text-right px-4 py-3 font-medium">Min Cart</th>
                    <th className="text-right px-4 py-3 font-medium">Used</th>
                    <th className="text-left px-4 py-3 font-medium">Window</th>
                    <th className="text-center px-4 py-3 font-medium">Status</th>
                    <th className="w-24" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((p) => (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {p.name}
                      </td>
                      <td className="px-4 py-3">
                        {p.code ? (
                          <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">
                            {p.code}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">auto</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {formatDiscount(p)}
                        {p.maxDiscount && (
                          <span className="text-xs text-gray-500 ml-1">
                            (max {formatPrice(p.maxDiscount)})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {p.minCartValue ? formatPrice(p.minCartValue) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-600">
                        {p.usageCount}
                        {p.usageLimit ? ` / ${p.usageLimit}` : ""}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {p.startDate || p.endDate ? (
                          <>
                            {p.startDate
                              ? new Date(p.startDate).toLocaleDateString()
                              : "any"}{" "}
                            –{" "}
                            {p.endDate
                              ? new Date(p.endDate).toLocaleDateString()
                              : "any"}
                          </>
                        ) : (
                          "always"
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => toggleActive(p)}
                          className={`inline-block px-2 py-0.5 text-xs rounded-full border transition-colors ${
                            p.isActive
                              ? "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                              : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                          }`}
                        >
                          {p.isActive ? "active" : "inactive"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => setEditing(p)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-500"
                            title="Edit"
                          >
                            <Icon icon="solar:pen-2-linear" className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => deletePromo(p)}
                            className="p-1.5 rounded hover:bg-red-50 text-gray-500 hover:text-red-600"
                            title="Delete"
                          >
                            <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {(creating || editing) && tenantId && (
        <PromotionForm
          tenantId={tenantId}
          currency={currency}
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PromotionForm({
  tenantId,
  currency,
  existing,
  onClose,
  onSaved,
}: {
  tenantId: string;
  currency: string;
  existing: Promotion | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(existing?.name || "");
  const [code, setCode] = useState(existing?.code || "");
  const [type, setType] = useState<"PERCENTAGE" | "FIXED_AMOUNT">(
    (existing?.discountType as any) || "PERCENTAGE"
  );
  const [value, setValue] = useState(
    existing
      ? existing.discountType === "PERCENTAGE"
        ? String(existing.discountValue)
        : (existing.discountValue / 100).toFixed(2)
      : "10"
  );
  const [maxDiscount, setMaxDiscount] = useState(
    existing?.maxDiscount ? (existing.maxDiscount / 100).toFixed(2) : ""
  );
  const [minCart, setMinCart] = useState(
    existing?.minCartValue ? (existing.minCartValue / 100).toFixed(2) : ""
  );
  const [startDate, setStartDate] = useState(
    existing?.startDate ? existing.startDate.slice(0, 10) : ""
  );
  const [endDate, setEndDate] = useState(
    existing?.endDate ? existing.endDate.slice(0, 10) : ""
  );
  const [usageLimit, setUsageLimit] = useState(
    existing?.usageLimit ? String(existing.usageLimit) : ""
  );
  const [isActive, setIsActive] = useState(existing?.isActive ?? true);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name,
        code: code.trim() || null,
        discountType: type,
        discountValue:
          type === "PERCENTAGE"
            ? Math.round(parseFloat(value || "0"))
            : Math.round(parseFloat(value || "0") * 100),
        maxDiscount: maxDiscount
          ? Math.round(parseFloat(maxDiscount) * 100)
          : null,
        minCartValue: minCart ? Math.round(parseFloat(minCart) * 100) : null,
        startDate: startDate || null,
        endDate: endDate || null,
        usageLimit: usageLimit ? parseInt(usageLimit, 10) : null,
        isActive,
      };
      const url = existing
        ? `/api/tenants/${tenantId}/promotions/${existing.id}`
        : `/api/tenants/${tenantId}/promotions`;
      const method = existing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && (data.success || data.promotion)) {
        toast.success(existing ? "Updated" : "Created");
        onSaved();
      } else {
        toast.error(data.error || "Save failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      size="lg"
      title={existing ? "Edit Promotion" : "New Promotion"}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer Sale"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Code (optional)
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="SUMMER10"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none font-mono uppercase"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Discount Type
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "PERCENTAGE" as const, label: "% Off" },
                { id: "FIXED_AMOUNT" as const, label: "$ Off" },
              ]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`p-3 rounded-xl border-2 text-sm font-medium transition-colors ${
                  type === t.id
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-gray-200 text-gray-700 hover:border-gray-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {type === "PERCENTAGE" ? "Percent" : `Amount (${currency})`}
            </label>
            <input
              type="number"
              step={type === "PERCENTAGE" ? "1" : "0.01"}
              min="0"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>
          {type === "PERCENTAGE" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max discount ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxDiscount}
                onChange={(e) => setMaxDiscount(e.target.value)}
                placeholder="Optional cap"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
              />
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Minimum cart ({currency})
          </label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={minCart}
            onChange={(e) => setMinCart(e.target.value)}
            placeholder="Optional — no minimum by default"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Starts
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ends
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Usage limit
            </label>
            <input
              type="number"
              min="0"
              value={usageLimit}
              onChange={(e) => setUsageLimit(e.target.value)}
              placeholder="Unlimited"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300"
          />
          <span className="text-gray-700">Active</span>
        </label>

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose} fullWidth>
            Cancel
          </Button>
          <Button onClick={submit} loading={submitting} fullWidth>
            {existing ? "Save Changes" : "Create Promotion"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Loading() {
  return (
    <div className="p-12 text-center text-gray-400">
      <Icon
        icon="solar:refresh-linear"
        className="w-8 h-8 animate-spin mx-auto mb-2"
      />
      Loading...
    </div>
  );
}

function Empty() {
  return (
    <div className="p-12 text-center text-gray-400">
      <Icon icon="solar:ticket-bold" className="w-12 h-12 mx-auto mb-3" />
      <p className="font-medium mb-1 text-gray-600">No promotions yet</p>
      <p className="text-sm">
        Create a promo code so cashiers can apply it at checkout.
      </p>
    </div>
  );
}
