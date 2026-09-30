"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Card, Badge, Modal, Toggle } from "@/components/ui";

interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  isActive: boolean;
  // Phase 8: set once the supplier has accepted our marketplace invite.
  // When present, this local Supplier row is linked to a real supplier
  // tenant we can order from through the marketplace.
  linkedTenantId?: string | null;
}

// Invitation the merchant has sent — surfaced in the "Pending invites" chip
// so they can chase or cancel outstanding ones.
interface Invite {
  id: string;
  email: string;
  companyName: string | null;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED";
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export default function SuppliersPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Add/edit modal state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  // Invite modal state — one modal handles both card-level invites (with a
  // localSupplierId prefill) and standalone "invite a new supplier" flows.
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitingFromSupplier, setInvitingFromSupplier] = useState<Supplier | null>(null);
  // Manual-share URL for the last invite. Populated when SES delivery
  // fails so the merchant can copy the link + text it to the supplier
  // themselves. Cleared when the modal reopens for a new invite.
  const [manualShareUrl, setManualShareUrl] = useState<string | null>(null);
  const [manualShareEmail, setManualShareEmail] = useState<string | null>(null);
  const [manualShareError, setManualShareError] = useState<string | null>(null);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    companyName: "",
    contactName: "",
    phone: "",
    message: "",
  });
  const [sendingInvite, setSendingInvite] = useState(false);

  // Pending invites modal
  const [showInvitesListModal, setShowInvitesListModal] = useState(false);

  // Form data
  const [formData, setFormData] = useState({
    name: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
    isActive: true,
  });

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;

    try {
      // Load suppliers + invites in parallel. If invites 404s (schema not yet
      // deployed), we still show the suppliers list — don't gate the page on
      // the new endpoint being live.
      const [sRes, iRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/suppliers`),
        fetch(`/api/tenants/${tenantId}/supplier-invites`),
      ]);
      const sData = await sRes.json();
      if (sData.success) setSuppliers(sData.suppliers);

      if (iRes.ok) {
        const iData = await iRes.json();
        if (iData.success) setInvites(iData.invites);
      }
    } catch (error) {
      toast.error("Failed to load suppliers");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  // ---- Invite helpers ----
  // A supplier is "invitable" if we have an email for them AND they aren't
  // already linked to a marketplace tenant AND there's no PENDING invite
  // already out for that email.
  const pendingEmails = new Set(
    invites.filter((i) => i.status === "PENDING").map((i) => i.email.toLowerCase())
  );
  const pendingCount = pendingEmails.size;

  const canInvite = (supplier: Supplier): boolean => {
    if (!supplier.email) return false;
    if (supplier.linkedTenantId) return false;
    if (pendingEmails.has(supplier.email.toLowerCase())) return false;
    return true;
  };

  const openInviteModal = (supplier?: Supplier) => {
    setInvitingFromSupplier(supplier || null);
    setInviteForm({
      email: supplier?.email || "",
      companyName: supplier?.name || "",
      contactName: supplier?.contactName || "",
      phone: supplier?.phone || "",
      message: "",
    });
    setShowInviteModal(true);
  };

  const submitInvite = async () => {
    if (!inviteForm.email.trim()) {
      toast.error("Email is required");
      return;
    }
    setSendingInvite(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/supplier-invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteForm.email.trim(),
          companyName: inviteForm.companyName.trim() || undefined,
          contactName: inviteForm.contactName.trim() || undefined,
          phone: inviteForm.phone.trim() || undefined,
          message: inviteForm.message.trim() || undefined,
          localSupplierId: invitingFromSupplier?.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to send invite");
        setSendingInvite(false);
        return;
      }
      if (data.emailDelivered === false) {
        // Persistent panel > toast — the link must survive long enough
        // to be copied. Toast disappears in 5s and doesn't fit a URL.
        setManualShareUrl(data.acceptUrl || null);
        setManualShareEmail(inviteForm.email);
        setManualShareError(data.emailError || "SES error");
        toast.warning(
          `Email couldn't be sent — copy the link below and share it manually.`
        );
      } else {
        toast.success(
          `Invite sent to ${inviteForm.email}. They have 14 days to accept.`
        );
        setManualShareUrl(null);
        setManualShareEmail(null);
        setManualShareError(null);
      }
      setShowInviteModal(false);
      loadData();
    } catch {
      toast.error("Failed to send invite");
    } finally {
      setSendingInvite(false);
    }
  };

  const cancelInvite = async (invite: Invite) => {
    if (!confirm(`Cancel the pending invite to ${invite.email}?`)) return;
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/supplier-invites/${invite.id}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        toast.success("Invite cancelled");
        loadData();
      } else {
        const data = await res.json();
        toast.error(data.error || "Failed to cancel");
      }
    } catch {
      toast.error("Failed to cancel invite");
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openModal = (supplier?: Supplier) => {
    if (supplier) {
      setEditing(supplier);
      setFormData({
        name: supplier.name,
        contactName: supplier.contactName || "",
        email: supplier.email || "",
        phone: supplier.phone || "",
        address: supplier.address || "",
        notes: supplier.notes || "",
        isActive: supplier.isActive,
      });
    } else {
      setEditing(null);
      setFormData({
        name: "",
        contactName: "",
        email: "",
        phone: "",
        address: "",
        notes: "",
        isActive: true,
      });
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Supplier name is required");
      return;
    }

    try {
      const payload = {
        name: formData.name,
        contactName: formData.contactName || undefined,
        email: formData.email || undefined,
        phone: formData.phone || undefined,
        address: formData.address || undefined,
        notes: formData.notes || undefined,
        isActive: formData.isActive,
      };

      const url = editing
        ? `/api/tenants/${tenantId}/suppliers/${editing.id}`
        : `/api/tenants/${tenantId}/suppliers`;

      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(editing ? "Supplier updated" : "Supplier created");
        setShowModal(false);
        loadData();
      } else {
        toast.error(data.error || "Failed to save supplier");
      }
    } catch (error) {
      toast.error("Failed to save supplier");
    }
  };

  const handleDelete = async (supplier: Supplier) => {
    if (!confirm(`Delete "${supplier.name}"?`)) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/suppliers/${supplier.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Supplier deleted");
        loadData();
      } else {
        toast.error(data.error || "Failed to delete supplier");
      }
    } catch (error) {
      toast.error("Failed to delete supplier");
    }
  };

  // Filter suppliers
  const filteredSuppliers = suppliers.filter(
    (supplier) =>
      !searchQuery ||
      supplier.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      supplier.contactName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      supplier.email?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Please select a business first</p>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Suppliers"
        subtitle={`${suppliers.length} supplier${suppliers.length !== 1 ? "s" : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {/* Pending invites chip — only visible when there's at least one */}
            {pendingCount > 0 && (
              <button
                onClick={() => setShowInvitesListModal(true)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 text-amber-800 text-sm font-medium hover:bg-amber-100 border border-amber-200"
                title="View pending invitations"
              >
                <Icon icon="solar:letter-bold" className="w-4 h-4" />
                {pendingCount} pending
              </button>
            )}
            <Button
              variant="secondary"
              icon="solar:letter-opened-bold"
              onClick={() => openInviteModal()}
            >
              Invite Supplier
            </Button>
            <Button icon="solar:add-circle-bold" onClick={() => openModal()}>
              Add Supplier
            </Button>
          </div>
        }
      />

      <div className="p-6">
        {/* Manual-share panel — appears when SES delivery fails so the
            merchant can copy the invite link and text/whatsapp/email it
            themselves. Persists until dismissed; toast would vanish
            before the URL could be copied. */}
        {manualShareUrl && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <Icon
                icon="solar:letter-unread-bold"
                className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-amber-900 text-sm">
                  Email couldn't be sent to {manualShareEmail}
                </p>
                <p className="text-xs text-amber-800 mt-0.5">
                  Copy the link below and share it via WhatsApp / SMS / your
                  own email. The invite is valid for 14 days.
                </p>
                {manualShareError && (
                  <p className="text-[11px] text-amber-700/80 mt-1 font-mono break-all">
                    {manualShareError}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-3">
                  <input
                    type="text"
                    readOnly
                    value={manualShareUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm font-mono bg-white border border-amber-200 text-gray-800"
                  />
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(manualShareUrl);
                        toast.success("Link copied");
                      } catch {
                        toast.error("Copy failed — select the URL and copy manually.");
                      }
                    }}
                    className="px-3 py-2 rounded-md bg-amber-700 text-white text-sm font-semibold hover:bg-amber-800"
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => {
                      setManualShareUrl(null);
                      setManualShareEmail(null);
                      setManualShareError(null);
                    }}
                    className="px-3 py-2 rounded-md text-amber-800 text-sm hover:bg-amber-100"
                    title="Dismiss"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="mb-6">
          <Input
            placeholder="Search suppliers..."
            icon="solar:magnifer-linear"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md"
          />
        </div>

        {/* Suppliers Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <div className="animate-pulse">
                  <div className="h-6 bg-gray-200 rounded w-1/2 mb-3" />
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
              </Card>
            ))}
          </div>
        ) : filteredSuppliers.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:buildings-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No suppliers found</h3>
            <p className="text-gray-500 mb-4">
              {searchQuery
                ? "Try adjusting your search"
                : "Add suppliers to manage your vendors"}
            </p>
            {!searchQuery && (
              <Button icon="solar:add-circle-bold" onClick={() => openModal()}>
                Add First Supplier
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSuppliers.map((supplier) => (
              <Card key={supplier.id} className="relative">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                      <Icon icon="solar:buildings-bold" className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{supplier.name}</h3>
                      {supplier.contactName && (
                        <p className="text-sm text-gray-500">{supplier.contactName}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {supplier.linkedTenantId && (
                      <Badge variant="success" size="sm">
                        <Icon icon="solar:check-circle-bold" className="w-3 h-3 mr-1 inline" />
                        On Marketplace
                      </Badge>
                    )}
                    {!supplier.linkedTenantId &&
                      supplier.email &&
                      pendingEmails.has(supplier.email.toLowerCase()) && (
                        <Badge variant="warning" size="sm">Invite sent</Badge>
                      )}
                    {!supplier.isActive && (
                      <Badge variant="danger" size="sm">Inactive</Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  {supplier.email && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Icon icon="solar:letter-linear" className="w-4 h-4" />
                      <a href={`mailto:${supplier.email}`} className="hover:text-indigo-600">
                        {supplier.email}
                      </a>
                    </div>
                  )}
                  {supplier.phone && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Icon icon="solar:phone-linear" className="w-4 h-4" />
                      <a href={`tel:${supplier.phone}`} className="hover:text-indigo-600">
                        {supplier.phone}
                      </a>
                    </div>
                  )}
                  {supplier.address && (
                    <div className="flex items-start gap-2 text-gray-600">
                      <Icon icon="solar:map-point-linear" className="w-4 h-4 mt-0.5" />
                      <span className="line-clamp-2">{supplier.address}</span>
                    </div>
                  )}
                </div>

                {supplier.notes && (
                  <p className="text-sm text-gray-400 mt-3 line-clamp-2">{supplier.notes}</p>
                )}

                <div className="flex items-center justify-between gap-2 mt-4 pt-4 border-t border-gray-100">
                  <div>
                    {canInvite(supplier) && (
                      <button
                        onClick={() => openInviteModal(supplier)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100"
                        title="Send an email inviting this supplier to join the marketplace"
                      >
                        <Icon icon="solar:letter-opened-bold" className="w-3.5 h-3.5" />
                        Invite to Marketplace
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openModal(supplier)}
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                    >
                      <Icon icon="solar:pen-linear" className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(supplier)}
                      className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                    >
                      <Icon icon="solar:trash-bin-trash-linear" className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Supplier Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? "Edit Supplier" : "New Supplier"}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Supplier Name"
              placeholder="e.g., Fresh Foods Inc."
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
            />
            <Input
              label="Contact Name"
              placeholder="e.g., John Smith"
              value={formData.contactName}
              onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Email"
              type="email"
              placeholder="email@supplier.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              icon="solar:letter-linear"
            />
            <Input
              label="Phone"
              type="tel"
              placeholder="+1 (555) 000-0000"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              icon="solar:phone-linear"
            />
          </div>

          <Input
            label="Address"
            placeholder="Full address..."
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            icon="solar:map-point-linear"
          />

          <Input
            label="Notes"
            placeholder="Additional notes about this supplier..."
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            multiline
            rows={3}
          />

          <Toggle
            label="Active"
            description="Supplier is available for orders"
            checked={formData.isActive}
            onChange={(checked) => setFormData({ ...formData, isActive: checked })}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editing ? "Save Changes" : "Create Supplier"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Invite Supplier Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title={
          invitingFromSupplier
            ? `Invite ${invitingFromSupplier.name} to Marketplace`
            : "Invite a Supplier to Marketplace"
        }
        size="md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-indigo-50 rounded-xl text-xs text-indigo-800 flex items-start gap-2">
            <Icon icon="solar:info-circle-bold" className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div>
              We'll email a secure invitation link. When the supplier accepts, they'll set up
              their own supplier portal — and their products become available for you to order.
              Invitation expires after 14 days.
            </div>
          </div>

          <Input
            label="Supplier email"
            type="email"
            placeholder="orders@supplier.com"
            value={inviteForm.email}
            onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
            required
            disabled={!!invitingFromSupplier?.email}
            helperText={
              invitingFromSupplier?.email
                ? "Using the email from the supplier record. Edit the supplier to change it."
                : undefined
            }
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Company name"
              placeholder="e.g. Fresh Foods Inc."
              value={inviteForm.companyName}
              onChange={(e) => setInviteForm({ ...inviteForm, companyName: e.target.value })}
            />
            <Input
              label="Contact name"
              placeholder="e.g. John Smith"
              value={inviteForm.contactName}
              onChange={(e) => setInviteForm({ ...inviteForm, contactName: e.target.value })}
            />
          </div>

          <Input
            label="Phone (optional)"
            type="tel"
            placeholder="+1 (555) 000-0000"
            value={inviteForm.phone}
            onChange={(e) => setInviteForm({ ...inviteForm, phone: e.target.value })}
          />

          <Input
            label="Personal message (optional)"
            placeholder="Hi — we'd love to order from you through our new POS supplier marketplace…"
            value={inviteForm.message}
            onChange={(e) => setInviteForm({ ...inviteForm, message: e.target.value })}
            multiline
            rows={3}
            helperText="Appears in the email so the recipient knows it's really from you."
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setShowInviteModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={submitInvite}
              disabled={sendingInvite}
              icon="solar:letter-opened-bold"
            >
              {sendingInvite ? "Sending…" : "Send Invitation"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Pending invitations list modal */}
      <Modal
        isOpen={showInvitesListModal}
        onClose={() => setShowInvitesListModal(false)}
        title="Pending Invitations"
        size="md"
      >
        <div className="space-y-3">
          {invites.filter((i) => i.status === "PENDING").length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Icon icon="solar:inbox-linear" className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              <p className="text-sm">No pending invitations</p>
            </div>
          ) : (
            invites
              .filter((i) => i.status === "PENDING")
              .map((invite) => (
                <div
                  key={invite.id}
                  className="flex items-center justify-between p-4 rounded-xl border border-gray-200 hover:border-gray-300"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {invite.companyName || invite.email}
                    </p>
                    {invite.companyName && (
                      <p className="text-xs text-gray-500 truncate">{invite.email}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      Sent {new Date(invite.createdAt).toLocaleDateString()} · Expires{" "}
                      {new Date(invite.expiresAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => cancelInvite(invite)}
                    className="ml-3 flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Cancel
                  </button>
                </div>
              ))
          )}

          {/* Recently accepted — small courtesy summary so the merchant can
              see the invite converted to a live relationship. */}
          {invites.filter((i) => i.status === "ACCEPTED").length > 0 && (
            <div className="pt-4 mt-4 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Recently accepted
              </p>
              {invites
                .filter((i) => i.status === "ACCEPTED")
                .slice(0, 5)
                .map((invite) => (
                  <div key={invite.id} className="flex items-center gap-3 py-2 text-sm">
                    <Icon icon="solar:check-circle-bold" className="w-4 h-4 text-green-500" />
                    <span className="text-gray-700 truncate">
                      {invite.companyName || invite.email}
                    </span>
                    <span className="text-xs text-gray-400 ml-auto flex-shrink-0">
                      {invite.acceptedAt && new Date(invite.acceptedAt).toLocaleDateString()}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
