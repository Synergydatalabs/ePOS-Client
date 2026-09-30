"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Card, Badge, Modal, Toggle, Select } from "@/components/ui";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type RewardType =
  | "DISCOUNT_PERCENTAGE"
  | "DISCOUNT_FIXED"
  | "FREE_PRODUCT"
  | "SPIN_WHEEL"
  | "MYSTERY_REWARD";

interface Reward {
  id: string;
  name: string;
  description?: string | null;
  pointsRequired: number;
  rewardType: RewardType;
  rewardValue: number;
  productId?: string | null;
  isActive: boolean;
  sortOrder: number;
  redemptionCount?: number;
}

interface Program {
  id: string;
  name: string;
  isActive: boolean;
  pointsPerDollar: number;
  pointsPerVisit: number;
  streakEnabled: boolean;
  streakDays: number;
  streakBonus: number;
  rewards?: Reward[];
  stats?: {
    totalCustomers: number;
    totalPointsOutstanding: number;
    totalLifetimePoints: number;
    totalCustomerSpend: number;
    avgVisitsPerCustomer: number;
  };
}

interface CustomerRow {
  id: string;
  email: string | null;
  phone: string | null;
  totalPoints: number;
  lifetimePoints: number;
  visitCount: number;
  totalSpent: number;
  lastVisit: string | null;
  currentStreak: number;
  longestStreak: number;
  createdAt: string;
}

const REWARD_TYPE_LABELS: Record<RewardType, string> = {
  DISCOUNT_PERCENTAGE: "% Discount",
  DISCOUNT_FIXED: "$ Off",
  FREE_PRODUCT: "Free Product",
  SPIN_WHEEL: "Spin the Wheel",
  MYSTERY_REWARD: "Mystery Reward",
};

const REWARD_TYPE_COLOR: Record<RewardType, "primary" | "success" | "warning" | "danger" | "gray"> = {
  DISCOUNT_PERCENTAGE: "primary",
  DISCOUNT_FIXED: "success",
  FREE_PRODUCT: "warning",
  SPIN_WHEEL: "danger",
  MYSTERY_REWARD: "gray",
};

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function LoyaltyPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tab, setTab] = useState<"program" | "rewards" | "customers">("program");

  const [program, setProgram] = useState<Program | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Program form state — mirrors the API contract
  const [pName, setPName] = useState("");
  const [pActive, setPActive] = useState(true);
  const [pPerDollar, setPPerDollar] = useState("1");
  const [pPerVisit, setPPerVisit] = useState("0");
  const [pStreakEnabled, setPStreakEnabled] = useState(false);
  const [pStreakDays, setPStreakDays] = useState("7");
  const [pStreakBonus, setPStreakBonus] = useState("50");

  // Rewards state
  const [rewardModalOpen, setRewardModalOpen] = useState(false);
  const [editingReward, setEditingReward] = useState<Reward | null>(null);
  const [rName, setRName] = useState("");
  const [rDesc, setRDesc] = useState("");
  const [rPoints, setRPoints] = useState("100");
  const [rType, setRType] = useState<RewardType>("DISCOUNT_PERCENTAGE");
  const [rValue, setRValue] = useState("10");
  const [rActive, setRActive] = useState(true);
  const [rSaving, setRSaving] = useState(false);

  // Customers state
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerPage, setCustomerPage] = useState(1);
  const [customerTotal, setCustomerTotal] = useState(0);
  const [customerTotalPages, setCustomerTotalPages] = useState(1);
  const [customerSort, setCustomerSort] = useState<"points" | "lifetime" | "visits" | "lastVisit">(
    "lastVisit"
  );

  useEffect(() => {
    const t = localStorage.getItem("tap_active_tenant") || localStorage.getItem("tenantId");
    if (t) setTenantId(t);
  }, []);

  // ── Load program + rewards ────────────────────────────────────
  const loadProgram = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/loyalty`);
      const data = await res.json();
      if (data.success) {
        const p: Program | null = data.program;
        setProgram(p);
        if (p) {
          setPName(p.name);
          setPActive(p.isActive);
          setPPerDollar(String(p.pointsPerDollar));
          setPPerVisit(String(p.pointsPerVisit));
          setPStreakEnabled(p.streakEnabled);
          setPStreakDays(String(p.streakDays));
          setPStreakBonus(String(p.streakBonus));
        } else {
          // First time — pre-fill sensible defaults so admin can just hit Save
          setPName("Loyalty Program");
          setPActive(false);
          setPPerDollar("1");
          setPPerVisit("0");
          setPStreakEnabled(false);
          setPStreakDays("7");
          setPStreakBonus("50");
        }
      } else {
        toast.error(data.error || "Failed to load loyalty program");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to load loyalty program");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadProgram();
  }, [loadProgram]);

  // ── Load customers when the Customers tab is opened / search changes ─
  const loadCustomers = useCallback(async () => {
    if (!tenantId) return;
    setCustomersLoading(true);
    try {
      const qs = new URLSearchParams({
        search: customerSearch,
        sort: customerSort,
        order: "desc",
        page: String(customerPage),
        limit: "25",
      });
      const res = await fetch(`/api/tenants/${tenantId}/loyalty/customers?${qs}`);
      const data = await res.json();
      if (data.success) {
        setCustomers(data.customers || []);
        setCustomerTotal(data.total || 0);
        setCustomerTotalPages(data.totalPages || 1);
      } else {
        toast.error(data.error || "Failed to load customers");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to load customers");
    } finally {
      setCustomersLoading(false);
    }
  }, [tenantId, customerSearch, customerSort, customerPage]);

  useEffect(() => {
    if (tab === "customers") loadCustomers();
  }, [tab, loadCustomers]);

  // ── Save program settings ────────────────────────────────────
  const handleSaveProgram = async () => {
    if (!tenantId) return;
    if (!pName.trim()) {
      toast.error("Program name is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/loyalty`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pName.trim(),
          isActive: pActive,
          pointsPerDollar: Number(pPerDollar) || 0,
          pointsPerVisit: Number(pPerVisit) || 0,
          streakEnabled: pStreakEnabled,
          streakDays: Number(pStreakDays) || 7,
          streakBonus: Number(pStreakBonus) || 0,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Loyalty program saved");
        loadProgram();
      } else {
        toast.error(data.error || "Failed to save");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ── Reward CRUD ──────────────────────────────────────────────
  const openNewReward = () => {
    setEditingReward(null);
    setRName("");
    setRDesc("");
    setRPoints("100");
    setRType("DISCOUNT_PERCENTAGE");
    setRValue("10");
    setRActive(true);
    setRewardModalOpen(true);
  };

  const openEditReward = (reward: Reward) => {
    setEditingReward(reward);
    setRName(reward.name);
    setRDesc(reward.description || "");
    setRPoints(String(reward.pointsRequired));
    setRType(reward.rewardType);
    setRValue(String(reward.rewardValue));
    setRActive(reward.isActive);
    setRewardModalOpen(true);
  };

  const handleSaveReward = async () => {
    if (!tenantId) return;
    if (!rName.trim()) {
      toast.error("Reward name required");
      return;
    }
    const points = Number(rPoints);
    if (!points || points < 1) {
      toast.error("Points required must be at least 1");
      return;
    }
    setRSaving(true);
    try {
      const payload = {
        name: rName.trim(),
        description: rDesc.trim() || null,
        pointsRequired: points,
        rewardType: rType,
        rewardValue: Number(rValue) || 0,
        isActive: rActive,
      };
      const url = editingReward
        ? `/api/tenants/${tenantId}/loyalty/rewards/${editingReward.id}`
        : `/api/tenants/${tenantId}/loyalty/rewards`;
      const res = await fetch(url, {
        method: editingReward ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(editingReward ? "Reward updated" : "Reward added");
        setRewardModalOpen(false);
        loadProgram();
      } else {
        toast.error(data.error || "Failed to save reward");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to save reward");
    } finally {
      setRSaving(false);
    }
  };

  const handleDeleteReward = async (reward: Reward) => {
    if (!tenantId) return;
    const msg = reward.redemptionCount
      ? `Reward "${reward.name}" has ${reward.redemptionCount} historical redemption(s). It will be archived (marked inactive) to preserve the audit trail. Continue?`
      : `Delete reward "${reward.name}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/loyalty/rewards/${reward.id}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.success) {
        toast.success(data.deactivated ? "Reward archived" : "Reward deleted");
        loadProgram();
      } else {
        toast.error(data.error || "Failed to delete reward");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete reward");
    }
  };

  // ── Formatting helpers ───────────────────────────────────────
  const formatCents = (cents: number) =>
    new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
      (cents || 0) / 100
    );

  const formatDate = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString() : "—";

  const formatRewardValue = (r: Reward) => {
    switch (r.rewardType) {
      case "DISCOUNT_PERCENTAGE":
        return `${r.rewardValue}% off`;
      case "DISCOUNT_FIXED":
        return `${formatCents(r.rewardValue)} off`;
      case "FREE_PRODUCT":
        return "Free item";
      case "SPIN_WHEEL":
        return "Spin the wheel";
      case "MYSTERY_REWARD":
        return "Mystery";
      default:
        return "—";
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  return (
    <div>
      <AdminHeader
        title="Loyalty"
        subtitle="Reward returning customers with points, offers and streaks"
        actions={
          tab === "rewards" && program ? (
            <Button icon="solar:add-circle-bold" onClick={openNewReward}>
              Add Reward
            </Button>
          ) : undefined
        }
      />

      {/* Tabs */}
      <div className="px-6 pt-4 border-b border-gray-100 bg-white">
        <div className="flex gap-2">
          {(
            [
              { key: "program", label: "Program", icon: "solar:settings-bold" },
              { key: "rewards", label: "Rewards", icon: "solar:gift-bold" },
              { key: "customers", label: "Customers", icon: "solar:users-group-rounded-bold" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors ${
                tab === t.key
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              <Icon icon={t.icon} className="w-5 h-5" />
              {t.label}
              {t.key === "customers" && program?.stats && (
                <span className="ml-1 text-xs bg-gray-100 rounded-full px-2 py-0.5">
                  {program.stats.totalCustomers}
                </span>
              )}
              {t.key === "rewards" && program?.rewards && (
                <span className="ml-1 text-xs bg-gray-100 rounded-full px-2 py-0.5">
                  {program.rewards.length}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <Icon
              icon="solar:refresh-bold"
              className="w-8 h-8 animate-spin text-indigo-500"
            />
          </div>
        ) : (
          <>
            {/* ─── PROGRAM TAB ─── */}
            {tab === "program" && (
              <div className="space-y-6 max-w-3xl">
                {/* Stats strip if program has customers */}
                {program?.stats && program.stats.totalCustomers > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <Card>
                      <p className="text-xs text-gray-500 uppercase font-medium">
                        Members
                      </p>
                      <p className="text-2xl font-bold text-gray-900 mt-1">
                        {program.stats.totalCustomers}
                      </p>
                    </Card>
                    <Card>
                      <p className="text-xs text-gray-500 uppercase font-medium">
                        Points Outstanding
                      </p>
                      <p className="text-2xl font-bold text-indigo-600 mt-1">
                        {program.stats.totalPointsOutstanding.toLocaleString()}
                      </p>
                    </Card>
                    <Card>
                      <p className="text-xs text-gray-500 uppercase font-medium">
                        Lifetime Points
                      </p>
                      <p className="text-2xl font-bold text-teal-600 mt-1">
                        {program.stats.totalLifetimePoints.toLocaleString()}
                      </p>
                    </Card>
                    <Card>
                      <p className="text-xs text-gray-500 uppercase font-medium">
                        Member Spend
                      </p>
                      <p className="text-2xl font-bold text-green-600 mt-1">
                        {formatCents(program.stats.totalCustomerSpend)}
                      </p>
                    </Card>
                  </div>
                )}

                <Card>
                  <div className="space-y-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          Program Settings
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                          Configure how customers earn points and streak bonuses.
                        </p>
                      </div>
                      <Toggle
                        label={pActive ? "Active" : "Inactive"}
                        checked={pActive}
                        onChange={setPActive}
                      />
                    </div>

                    <Input
                      label="Program name"
                      value={pName}
                      onChange={(e) => setPName(e.target.value)}
                      placeholder="e.g. Coffee Rewards"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Input
                        label="Points per $1 spent"
                        type="number"
                        min={0}
                        value={pPerDollar}
                        onChange={(e) => setPPerDollar(e.target.value)}
                        hint="Set to 0 to disable spend-based points."
                      />
                      <Input
                        label="Points per visit"
                        type="number"
                        min={0}
                        value={pPerVisit}
                        onChange={(e) => setPPerVisit(e.target.value)}
                        hint="Extra points every time a customer visits."
                      />
                    </div>

                    <div className="border-t border-gray-100 pt-5">
                      <Toggle
                        label="Streak bonuses"
                        description="Reward customers who visit multiple days in a row."
                        checked={pStreakEnabled}
                        onChange={setPStreakEnabled}
                      />
                      {pStreakEnabled && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                          <Input
                            label="Streak length (days)"
                            type="number"
                            min={2}
                            value={pStreakDays}
                            onChange={(e) => setPStreakDays(e.target.value)}
                          />
                          <Input
                            label="Streak bonus points"
                            type="number"
                            min={0}
                            value={pStreakBonus}
                            onChange={(e) => setPStreakBonus(e.target.value)}
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end">
                      <Button onClick={handleSaveProgram} loading={saving}>
                        Save Program
                      </Button>
                    </div>
                  </div>
                </Card>
              </div>
            )}

            {/* ─── REWARDS TAB ─── */}
            {tab === "rewards" && (
              <div className="space-y-4">
                {!program?.rewards || program.rewards.length === 0 ? (
                  <Card className="text-center py-16">
                    <Icon
                      icon="solar:gift-linear"
                      className="w-16 h-16 text-gray-300 mx-auto mb-4"
                    />
                    <h3 className="text-lg font-semibold text-gray-900">
                      No rewards yet
                    </h3>
                    <p className="text-gray-500 mb-4">
                      Add rewards customers can redeem with their points.
                    </p>
                    <Button
                      icon="solar:add-circle-bold"
                      onClick={openNewReward}
                    >
                      Add Reward
                    </Button>
                  </Card>
                ) : (
                  <Card className="!p-0 overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50 text-left">
                        <tr>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Reward
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Type
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Value
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Cost
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Redemptions
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Status
                          </th>
                          <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {program.rewards.map((r) => (
                          <tr key={r.id} className="hover:bg-gray-50">
                            <td className="px-6 py-3">
                              <p className="font-medium text-gray-900">{r.name}</p>
                              {r.description && (
                                <p className="text-xs text-gray-500 mt-0.5">
                                  {r.description}
                                </p>
                              )}
                            </td>
                            <td className="px-6 py-3">
                              <Badge variant={REWARD_TYPE_COLOR[r.rewardType]} size="sm">
                                {REWARD_TYPE_LABELS[r.rewardType]}
                              </Badge>
                            </td>
                            <td className="px-6 py-3 text-sm text-gray-900 font-medium">
                              {formatRewardValue(r)}
                            </td>
                            <td className="px-6 py-3 text-sm text-gray-900">
                              <span className="font-semibold text-indigo-600">
                                {r.pointsRequired.toLocaleString()}
                              </span>{" "}
                              pts
                            </td>
                            <td className="px-6 py-3 text-sm text-gray-700">
                              {r.redemptionCount ?? 0}
                            </td>
                            <td className="px-6 py-3">
                              {r.isActive ? (
                                <Badge variant="success" size="sm">Active</Badge>
                              ) : (
                                <Badge variant="gray" size="sm">Inactive</Badge>
                              )}
                            </td>
                            <td className="px-6 py-3 text-right">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={() => openEditReward(r)}
                                  className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-indigo-600"
                                  title="Edit"
                                >
                                  <Icon icon="solar:pen-2-linear" className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteReward(r)}
                                  className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-red-600"
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
                  </Card>
                )}
              </div>
            )}

            {/* ─── CUSTOMERS TAB ─── */}
            {tab === "customers" && (
              <div className="space-y-4">
                <Card className="!p-4">
                  <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                    <div className="flex-1">
                      <Input
                        icon="solar:magnifer-linear"
                        placeholder="Search by email or phone..."
                        value={customerSearch}
                        onChange={(e) => {
                          setCustomerSearch(e.target.value);
                          setCustomerPage(1);
                        }}
                      />
                    </div>
                    <Select
                      value={customerSort}
                      onChange={(e) => setCustomerSort(e.target.value as any)}
                      options={[
                        { value: "lastVisit", label: "Sort: Last visit" },
                        { value: "points", label: "Sort: Current points" },
                        { value: "lifetime", label: "Sort: Lifetime points" },
                        { value: "visits", label: "Sort: Visits" },
                      ]}
                    />
                  </div>
                </Card>

                {customersLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Icon
                      icon="solar:refresh-bold"
                      className="w-8 h-8 animate-spin text-indigo-500"
                    />
                  </div>
                ) : customers.length === 0 ? (
                  <Card className="text-center py-16">
                    <Icon
                      icon="solar:users-group-rounded-linear"
                      className="w-16 h-16 text-gray-300 mx-auto mb-4"
                    />
                    <p className="text-gray-500">
                      {customerSearch
                        ? "No customers match that search."
                        : "No loyalty members yet — they'll appear here after their first earned points."}
                    </p>
                  </Card>
                ) : (
                  <Card className="!p-0 overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-50 text-left">
                        <tr>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Contact
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Points
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Lifetime
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Visits
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Spent
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Streak
                          </th>
                          <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                            Last visit
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {customers.map((c) => (
                          <tr key={c.id} className="hover:bg-gray-50">
                            <td className="px-6 py-3">
                              {c.email && (
                                <p className="text-sm text-gray-900">{c.email}</p>
                              )}
                              {c.phone && (
                                <p className="text-xs text-gray-500">{c.phone}</p>
                              )}
                              {!c.email && !c.phone && (
                                <p className="text-xs text-gray-400 italic">
                                  Guest
                                </p>
                              )}
                            </td>
                            <td className="px-6 py-3 text-sm">
                              <span className="font-semibold text-indigo-600">
                                {c.totalPoints.toLocaleString()}
                              </span>
                            </td>
                            <td className="px-6 py-3 text-sm text-gray-700">
                              {c.lifetimePoints.toLocaleString()}
                            </td>
                            <td className="px-6 py-3 text-sm text-gray-700">
                              {c.visitCount}
                            </td>
                            <td className="px-6 py-3 text-sm text-gray-700">
                              {formatCents(c.totalSpent)}
                            </td>
                            <td className="px-6 py-3 text-sm">
                              <span className="text-gray-700">
                                {c.currentStreak}
                              </span>
                              <span className="text-xs text-gray-400 ml-1">
                                / {c.longestStreak}
                              </span>
                            </td>
                            <td className="px-6 py-3 text-sm text-gray-700">
                              {formatDate(c.lastVisit)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                )}

                {/* Pagination */}
                {customers.length > 0 && customerTotalPages > 1 && (
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-500">
                      Page {customerPage} of {customerTotalPages}{" "}
                      <span className="text-gray-400">
                        ({customerTotal.toLocaleString()} members)
                      </span>
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={customerPage <= 1}
                        onClick={() => setCustomerPage((p) => Math.max(1, p - 1))}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={customerPage >= customerTotalPages}
                        onClick={() =>
                          setCustomerPage((p) => Math.min(customerTotalPages, p + 1))
                        }
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Reward add/edit modal */}
      <Modal
        isOpen={rewardModalOpen}
        onClose={() => setRewardModalOpen(false)}
        title={editingReward ? "Edit Reward" : "New Reward"}
        size="md"
      >
        <div className="space-y-4">
          <Input
            label="Reward name"
            value={rName}
            onChange={(e) => setRName(e.target.value)}
            placeholder="e.g. Free coffee"
          />
          <Input
            label="Description (optional)"
            value={rDesc}
            onChange={(e) => setRDesc(e.target.value)}
            placeholder="Short description customers will see"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Points required"
              type="number"
              min={1}
              value={rPoints}
              onChange={(e) => setRPoints(e.target.value)}
            />
            <Select
              label="Reward type"
              value={rType}
              onChange={(e) => setRType(e.target.value as RewardType)}
              options={[
                { value: "DISCOUNT_PERCENTAGE", label: "% Discount" },
                { value: "DISCOUNT_FIXED", label: "$ Off" },
                { value: "FREE_PRODUCT", label: "Free product" },
                { value: "SPIN_WHEEL", label: "Spin the wheel" },
                { value: "MYSTERY_REWARD", label: "Mystery reward" },
              ]}
            />
          </div>
          {(rType === "DISCOUNT_PERCENTAGE" || rType === "DISCOUNT_FIXED") && (
            <Input
              label={
                rType === "DISCOUNT_PERCENTAGE"
                  ? "Discount percentage (1–100)"
                  : "Discount amount in cents (e.g. 500 = $5.00)"
              }
              type="number"
              min={0}
              value={rValue}
              onChange={(e) => setRValue(e.target.value)}
            />
          )}
          <Toggle
            label={rActive ? "Reward is active" : "Reward is inactive"}
            checked={rActive}
            onChange={setRActive}
          />
          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setRewardModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveReward} loading={rSaving}>
              {editingReward ? "Save Changes" : "Add Reward"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
