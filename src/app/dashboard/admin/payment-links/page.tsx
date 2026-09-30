"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Card, Badge, Modal, Select } from "@/components/ui";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type LinkStatus = "PENDING" | "PAID" | "EXPIRED" | "CANCELLED";

interface PaymentLink {
  id: string;
  url: string;
  orderNumber: string;
  amount: number;
  currency: string;
  description: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  status: LinkStatus;
  expiresAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

const STATUS_COLOR: Record<LinkStatus, "primary" | "success" | "warning" | "danger" | "gray"> = {
  PENDING: "primary",
  PAID: "success",
  EXPIRED: "warning",
  CANCELLED: "gray",
};

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
export default function PaymentLinksPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [links, setLinks] = useState<PaymentLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<
    "all" | "pending" | "paid" | "expired" | "cancelled"
  >("all");
  const [search, setSearch] = useState("");

  // Create modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [cName, setCName] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [creating, setCreating] = useState(false);

  // Share modal state
  const [shareLink, setShareLink] = useState<PaymentLink | null>(null);

  useEffect(() => {
    const t =
      localStorage.getItem("tap_active_tenant") ||
      localStorage.getItem("tenantId");
    if (t) setTenantId(t);
  }, []);

  const loadLinks = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        status: statusFilter,
        search,
        page: String(page),
        limit: "25",
      });
      const res = await fetch(`/api/tenants/${tenantId}/payment-links?${qs}`);
      const data = await res.json();
      if (data.success) {
        setLinks(data.links || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      } else {
        toast.error(data.error || "Failed to load links");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to load links");
    } finally {
      setLoading(false);
    }
  }, [tenantId, statusFilter, search, page]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks]);

  const resetCreateForm = () => {
    setAmount("");
    setDescription("");
    setCName("");
    setCEmail("");
    setCPhone("");
    setExpiresInDays("7");
  };

  const handleCreate = async () => {
    if (!tenantId) return;
    const dollars = Number(amount);
    if (!dollars || dollars <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/payment-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Math.round(dollars * 100), // to cents
          description: description || null,
          customerName: cName || null,
          customerEmail: cEmail || null,
          customerPhone: cPhone || null,
          expiresInDays: Number(expiresInDays) || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success("Payment link created");
        setCreateOpen(false);
        resetCreateForm();
        // Immediately open share modal with the freshly created link
        setShareLink({
          ...data.link,
          orderNumber: "",
          status: "PENDING",
          paidAt: null,
        });
        loadLinks();
      } else {
        toast.error(data.error || "Failed to create link");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to create link");
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = async (link: PaymentLink) => {
    if (!tenantId) return;
    if (!confirm(`Cancel this payment link for ${formatCents(link.amount)}?`))
      return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/payment-links/${link.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cancel" }),
        }
      );
      const data = await res.json();
      if (data.success) {
        toast.success("Payment link cancelled");
        loadLinks();
      } else {
        toast.error(data.error || "Failed to cancel");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to cancel");
    }
  };

  const handleDelete = async (link: PaymentLink) => {
    if (!tenantId) return;
    if (
      !confirm(
        `Delete this payment link permanently? This cannot be undone.`
      )
    )
      return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/payment-links/${link.id}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (data.success) {
        toast.success("Payment link deleted");
        loadLinks();
      } else {
        toast.error(data.error || "Failed to delete");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to delete");
    }
  };

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied to clipboard");
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────
  function formatCents(cents: number) {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format((cents || 0) / 100);
  }

  function formatDate(d?: string | null) {
    if (!d) return "—";
    return new Date(d).toLocaleString("en-CA", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  }

  const shareText = (link: PaymentLink) => {
    const desc = link.description ? `: ${link.description}` : "";
    return `Please complete your payment of ${formatCents(link.amount)}${desc}. Pay here: ${link.url}`;
  };

  return (
    <div>
      <AdminHeader
        title="Payment Links"
        subtitle="Send a URL, get paid — no terminal needed"
        actions={
          <Button
            icon="solar:add-circle-bold"
            onClick={() => setCreateOpen(true)}
          >
            Create Link
          </Button>
        }
      />

      <div className="p-6 space-y-4">
        {/* Filters */}
        <Card className="!p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
            <div className="flex-1">
              <Input
                icon="solar:magnifer-linear"
                placeholder="Search by name, email, phone or order #..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setPage(1);
              }}
              options={[
                { value: "all", label: "All statuses" },
                { value: "pending", label: "Pending only" },
                { value: "paid", label: "Paid only" },
                { value: "expired", label: "Expired only" },
                { value: "cancelled", label: "Cancelled only" },
              ]}
            />
          </div>
        </Card>

        {/* Table */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Icon
              icon="solar:refresh-bold"
              className="w-8 h-8 animate-spin text-indigo-500"
            />
          </div>
        ) : links.length === 0 ? (
          <Card className="text-center py-16">
            <Icon
              icon="solar:link-round-linear"
              className="w-16 h-16 text-gray-300 mx-auto mb-4"
            />
            <h3 className="text-lg font-semibold text-gray-900">
              No payment links yet
            </h3>
            <p className="text-gray-500 mb-4">
              {search || statusFilter !== "all"
                ? "No links match your filter."
                : "Create a link and share it via SMS, WhatsApp or email."}
            </p>
            <Button
              icon="solar:add-circle-bold"
              onClick={() => setCreateOpen(true)}
            >
              Create Link
            </Button>
          </Card>
        ) : (
          <Card className="!p-0 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Customer
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Description
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Created
                  </th>
                  <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase">
                    Expires
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {links.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3">
                      <p className="font-semibold text-gray-900">
                        {formatCents(l.amount)}
                      </p>
                    </td>
                    <td className="px-6 py-3 text-sm">
                      {l.customerName && (
                        <p className="font-medium text-gray-900">
                          {l.customerName}
                        </p>
                      )}
                      {l.customerEmail && (
                        <p className="text-xs text-gray-500">
                          {l.customerEmail}
                        </p>
                      )}
                      {l.customerPhone && !l.customerEmail && (
                        <p className="text-xs text-gray-500">
                          {l.customerPhone}
                        </p>
                      )}
                      {!l.customerName && !l.customerEmail && !l.customerPhone && (
                        <span className="text-xs text-gray-400 italic">
                          No customer info
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3 text-sm text-gray-700 max-w-[240px] truncate">
                      {l.description || (
                        <span className="text-gray-400 italic">—</span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <Badge variant={STATUS_COLOR[l.status]} size="sm">
                        {l.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-3 text-xs text-gray-500">
                      {formatDate(l.createdAt)}
                    </td>
                    <td className="px-6 py-3 text-xs text-gray-500">
                      {formatDate(l.expiresAt)}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setShareLink(l)}
                          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-indigo-600"
                          title="Share"
                        >
                          <Icon icon="solar:share-bold" className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => copyUrl(l.url)}
                          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-indigo-600"
                          title="Copy URL"
                        >
                          <Icon icon="solar:copy-bold" className="w-4 h-4" />
                        </button>
                        {l.status === "PENDING" && (
                          <button
                            onClick={() => handleCancel(l)}
                            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-amber-600"
                            title="Cancel"
                          >
                            <Icon
                              icon="solar:close-circle-linear"
                              className="w-4 h-4"
                            />
                          </button>
                        )}
                        {l.status !== "PAID" && (
                          <button
                            onClick={() => handleDelete(l)}
                            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-500 hover:text-red-600"
                            title="Delete"
                          >
                            <Icon
                              icon="solar:trash-bin-trash-linear"
                              className="w-4 h-4"
                            />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {/* Pagination */}
        {links.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">
              Page {page} of {totalPages}{" "}
              <span className="text-gray-400">
                ({total.toLocaleString()} links)
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Create modal */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Payment Link"
        size="md"
      >
        <div className="space-y-4">
          <Input
            label="Amount (CAD)"
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="e.g. 45.00"
          />
          <Input
            label="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Invoice #123 — dining deposit"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Customer name (optional)"
              value={cName}
              onChange={(e) => setCName(e.target.value)}
              placeholder="e.g. Jane Doe"
            />
            <Input
              label="Phone (optional)"
              value={cPhone}
              onChange={(e) => setCPhone(e.target.value)}
              placeholder="+1 555 123 4567"
            />
          </div>
          <Input
            label="Email (optional)"
            type="email"
            value={cEmail}
            onChange={(e) => setCEmail(e.target.value)}
            placeholder="customer@example.com"
          />
          <Select
            label="Expires in"
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            options={[
              { value: "1", label: "1 day" },
              { value: "3", label: "3 days" },
              { value: "7", label: "7 days" },
              { value: "14", label: "14 days" },
              { value: "30", label: "30 days" },
              { value: "0", label: "No expiry" },
            ]}
          />

          <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} loading={creating}>
              Create & Share
            </Button>
          </div>
        </div>
      </Modal>

      {/* Share modal */}
      <Modal
        isOpen={!!shareLink}
        onClose={() => setShareLink(null)}
        title="Share Payment Link"
        size="md"
      >
        {shareLink && (
          <div className="space-y-4">
            <div className="text-center py-4">
              <p className="text-sm text-gray-500">Amount</p>
              <p className="text-4xl font-bold text-indigo-600 mt-1">
                {formatCents(shareLink.amount)}
              </p>
              {shareLink.description && (
                <p className="text-sm text-gray-600 mt-2">
                  {shareLink.description}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Payment URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareLink.url}
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-200 bg-gray-50 text-sm font-mono"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  variant="secondary"
                  icon="solar:copy-bold"
                  onClick={() => copyUrl(shareLink.url)}
                >
                  Copy
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
              {shareLink.customerPhone && (
                <a
                  href={`sms:${shareLink.customerPhone}?body=${encodeURIComponent(shareText(shareLink))}`}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
                >
                  <Icon
                    icon="solar:chat-round-dots-bold"
                    className="w-6 h-6 text-indigo-600"
                  />
                  <span className="text-xs font-medium text-gray-700">SMS</span>
                </a>
              )}
              {shareLink.customerPhone && (
                <a
                  href={`https://wa.me/${shareLink.customerPhone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(shareText(shareLink))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-colors"
                >
                  <Icon
                    icon="solar:phone-calling-bold"
                    className="w-6 h-6 text-green-600"
                  />
                  <span className="text-xs font-medium text-gray-700">
                    WhatsApp
                  </span>
                </a>
              )}
              {shareLink.customerEmail && (
                <a
                  href={`mailto:${shareLink.customerEmail}?subject=${encodeURIComponent("Payment link")}&body=${encodeURIComponent(shareText(shareLink))}`}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border border-gray-200 hover:border-amber-300 hover:bg-amber-50 transition-colors"
                >
                  <Icon
                    icon="solar:letter-bold"
                    className="w-6 h-6 text-amber-600"
                  />
                  <span className="text-xs font-medium text-gray-700">Email</span>
                </a>
              )}
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator
                      .share({
                        title: "Payment Link",
                        text: shareText(shareLink),
                        url: shareLink.url,
                      })
                      .catch(() => {});
                  } else {
                    copyUrl(shareLink.url);
                  }
                }}
                className="flex flex-col items-center gap-2 p-3 rounded-xl border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors"
              >
                <Icon
                  icon="solar:share-bold"
                  className="w-6 h-6 text-indigo-600"
                />
                <span className="text-xs font-medium text-gray-700">More</span>
              </button>
            </div>

            {!shareLink.customerPhone && !shareLink.customerEmail && (
              <p className="text-xs text-gray-500 text-center pt-2">
                Tip: add customer phone or email to enable one-tap SMS / WhatsApp
                / email sending.
              </p>
            )}

            <div className="flex justify-end pt-4 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setShareLink(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
