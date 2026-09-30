"use client";

import { useEffect, useState, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Card, Badge, Modal, Input, Select, Toggle } from "@/components/ui";

interface Member {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  status: string;
  hasPassword?: boolean;
  mustChangePassword?: boolean;
  specialties?: string[];
  commissionRate?: number | null;
  lastActiveAt?: string;
  createdAt: string;
}

interface ServiceOption {
  id: string;
  name: string;
}

const ROLES = [
  { value: "TENANT_OWNER", label: "Owner", description: "Full access to everything" },
  { value: "POS_ADMIN", label: "Admin", description: "Manage settings and staff" },
  { value: "POS_MANAGER", label: "Manager", description: "View reports, manage orders" },
  { value: "POS_STAFF", label: "Staff", description: "POS counter access" },
  { value: "KITCHEN_STAFF", label: "Kitchen", description: "Kitchen display only" },
];

export default function TeamPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTempPassword, setShowTempPassword] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [businessType, setBusinessType] = useState("restaurant");
  const [services, setServices] = useState<ServiceOption[]>([]);

  const isSalon = businessType === "salon";

  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    role: "POS_STAFF",
    password: "",
    generatePassword: true,
    specialties: [] as string[],
    commissionRate: "",
  });

  useEffect(() => {
    const storedTenant = localStorage.getItem("tap_active_tenant");
    if (storedTenant) {
      setTenantId(storedTenant);
      // Load business type from settings
      fetch(`/api/tenants/${storedTenant}/settings`)
        .then((r) => r.json())
        .then((data) => {
          if (data.success && data.tenant?.businessType) {
            setBusinessType(data.tenant.businessType);
          }
        })
        .catch(() => {});
      // Load services for salon specialties picker
      fetch(`/api/tenants/${storedTenant}/products`)
        .then((r) => r.json())
        .then((data) => {
          if (data.success) {
            setServices(
              (data.products || []).map((p: any) => ({ id: p.id, name: p.name }))
            );
          }
        })
        .catch(() => {});
    }
  }, []);

  const loadMembers = useCallback(async () => {
    if (!tenantId) return;

    try {
      const response = await fetch(`/api/tenants/${tenantId}/members`);
      const data = await response.json();

      if (data.success) {
        setMembers(data.members);
      }
    } catch (error) {
      toast.error("Failed to load team members");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const resetForm = () => {
    setFormData({
      email: "",
      firstName: "",
      lastName: "",
      role: "POS_STAFF",
      password: "",
      generatePassword: true,
      specialties: [],
      commissionRate: "",
    });
  };

  const handleAddMember = async () => {
    if (!formData.email.trim()) {
      toast.error("Please enter an email address");
      return;
    }

    if (!formData.generatePassword && formData.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`/api/tenants/${tenantId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: formData.email,
          firstName: formData.firstName || undefined,
          lastName: formData.lastName || undefined,
          role: formData.role,
          password: formData.generatePassword ? undefined : formData.password,
          generatePassword: formData.generatePassword,
          ...(isSalon ? {
            specialties: formData.specialties,
            commissionRate: formData.commissionRate ? parseFloat(formData.commissionRate) : null,
          } : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to add member");
      }

      // Show temporary password if generated
      if (data.tempPassword) {
        setShowTempPassword(data.tempPassword);
      } else {
        toast.success("Team member added!");
        setShowAddModal(false);
        resetForm();
      }

      loadMembers();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCloseTempPassword = () => {
    setShowTempPassword(null);
    setShowAddModal(false);
    resetForm();
  };

  const handleRemove = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email} from your team?`)) return;

    try {
      const response = await fetch(`/api/tenants/${tenantId}/members/${memberId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Failed to remove member");
        return;
      }

      toast.success("Member removed");
      loadMembers();
    } catch (error: any) {
      toast.error(error.message || "Failed to remove member");
    }
  };

  const handleUpdateRole = async (memberId: string, newRole: string) => {
    try {
      const response = await fetch(`/api/tenants/${tenantId}/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update role");
      }

      toast.success("Role updated");
      loadMembers();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "TENANT_OWNER":
        return "purple";
      case "POS_ADMIN":
        return "primary";
      case "POS_MANAGER":
        return "success";
      case "POS_STAFF":
        return "default";
      case "KITCHEN_STAFF":
        return "warning";
      default:
        return "default";
    }
  };

  const getRoleLabel = (role: string) => {
    return ROLES.find((r) => r.value === role)?.label || role;
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard!");
  };

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
        title={isSalon ? "Team & Technicians" : "Team Members"}
        subtitle={isSalon ? "Manage your technicians and staff" : "Manage your staff and their POS access"}
        actions={
          <Button icon="solar:user-plus-bold" onClick={() => setShowAddModal(true)}>
            Add Staff
          </Button>
        }
      />

      <div className="p-6">
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <div className="animate-pulse">
                  <div className="w-12 h-12 bg-gray-200 rounded-full mb-3" />
                  <div className="h-5 bg-gray-200 rounded w-2/3 mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
              </Card>
            ))}
          </div>
        ) : members.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:users-group-rounded-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No team members</h3>
            <p className="text-gray-500 mb-4">Add staff to help manage your business</p>
            <Button icon="solar:user-plus-bold" onClick={() => setShowAddModal(true)}>
              Add First Staff
            </Button>
          </Card>
        ) : (
          <>
            {/* POS Login Info */}
            <div className="mb-6 p-4 bg-indigo-50 rounded-xl">
              <div className="flex items-start gap-3">
                <Icon icon="solar:info-circle-linear" className="w-5 h-5 text-indigo-600 mt-0.5" />
                <div>
                  <p className="text-indigo-800 text-sm font-medium">Staff Login URL</p>
                  <p className="text-indigo-600 text-sm mt-1">
                    Staff can login at:{" "}
                    <code className="bg-white px-2 py-1 rounded text-xs">
                      {typeof window !== "undefined" ? `${window.location.origin}/pos/login` : "/pos/login"}
                    </code>
                    <button
                      onClick={() => copyToClipboard(`${window.location.origin}/pos/login`)}
                      className="ml-2 text-indigo-700 hover:text-indigo-800"
                    >
                      <Icon icon="solar:copy-linear" className="w-4 h-4 inline" />
                    </button>
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {members.map((member) => (
                <Card key={member.id}>
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                      {member.firstName
                        ? member.firstName[0].toUpperCase()
                        : member.email[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900 truncate">
                          {member.firstName && member.lastName
                            ? `${member.firstName} ${member.lastName}`
                            : member.email.split("@")[0]}
                        </h3>
                      </div>
                      <p className="text-sm text-gray-500 truncate">{member.email}</p>
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <Badge variant={getRoleColor(member.role) as any} size="sm">
                          {getRoleLabel(member.role)}
                        </Badge>
                        {member.hasPassword && (
                          <Badge variant="success" size="sm">
                            <Icon icon="solar:key-linear" className="w-3 h-3 mr-1" />
                            POS Access
                          </Badge>
                        )}
                        {member.mustChangePassword && (
                          <Badge variant="warning" size="sm">
                            Needs Password Reset
                          </Badge>
                        )}
                      </div>
                      {isSalon && member.specialties && member.specialties.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-gray-400 mb-1">Services:</p>
                          <div className="flex flex-wrap gap-1">
                            {member.specialties.map((sid) => {
                              const svc = services.find((s) => s.id === sid);
                              return (
                                <span key={sid} className="px-2 py-0.5 bg-purple-50 text-purple-600 text-xs rounded-full">
                                  {svc?.name || sid.slice(0, 8)}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {isSalon && member.commissionRate != null && (
                        <p className="text-xs text-gray-500 mt-1">
                          Commission: {member.commissionRate}%
                        </p>
                      )}
                      {member.lastActiveAt && (
                        <p className="text-xs text-gray-400 mt-2">
                          Last active: {new Date(member.lastActiveAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  </div>

                  {member.role !== "TENANT_OWNER" && (
                    <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-gray-100">
                      <select
                        value={member.role}
                        onChange={(e) => handleUpdateRole(member.id, e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-gray-900"
                      >
                        {ROLES.filter((r) => r.value !== "TENANT_OWNER").map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleRemove(member.id, member.email)}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                      >
                        <Icon icon="solar:trash-bin-trash-linear" className="w-5 h-5" />
                      </button>
                    </div>
                  )}

                  {member.role === "TENANT_OWNER" && (
                    <div className="mt-4 pt-4 border-t border-gray-100 text-center">
                      <span className="text-sm text-gray-400">Business Owner</span>
                    </div>
                  )}
                </Card>
              ))}
            </div>

            {/* Role Descriptions */}
            <Card className="mt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Role Permissions</h3>
              <div className="grid gap-3">
                {ROLES.map((role) => (
                  <div key={role.value} className="flex items-center gap-3">
                    <Badge variant={getRoleColor(role.value) as any} size="sm">
                      {role.label}
                    </Badge>
                    <p className="text-sm text-gray-600">{role.description}</p>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>

      {/* Add Staff Modal */}
      <Modal
        isOpen={showAddModal && !showTempPassword}
        onClose={() => {
          setShowAddModal(false);
          resetForm();
        }}
        title="Add Staff Member"
        size="md"
      >
        <div className="space-y-4">
          <Input
            label="Email Address"
            type="email"
            placeholder="staff@example.com"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="First Name"
              placeholder="John"
              value={formData.firstName}
              onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
            />
            <Input
              label="Last Name"
              placeholder="Doe"
              value={formData.lastName}
              onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
            />
          </div>

          <Select
            label="Role"
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            options={ROLES.filter((r) => r.value !== "TENANT_OWNER").map((role) => ({
              value: role.value,
              label: `${role.label} - ${role.description}`,
            }))}
          />

          {isSalon && (
            <div className="border-t border-gray-200 pt-4 space-y-4">
              <h4 className="font-medium text-gray-900">Technician Settings</h4>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Service Specialties</label>
                <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                  {services.length === 0 ? (
                    <p className="text-sm text-gray-400 p-2">No services created yet</p>
                  ) : (
                    services.map((svc) => (
                      <label key={svc.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.specialties.includes(svc.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setFormData({ ...formData, specialties: [...formData.specialties, svc.id] });
                            } else {
                              setFormData({ ...formData, specialties: formData.specialties.filter((s) => s !== svc.id) });
                            }
                          }}
                          className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="text-sm text-gray-700">{svc.name}</span>
                      </label>
                    ))
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1">Leave empty if technician can perform all services</p>
              </div>

              <Input
                label="Commission Rate (%)"
                type="number"
                placeholder="e.g. 40"
                value={formData.commissionRate}
                onChange={(e) => setFormData({ ...formData, commissionRate: e.target.value })}
              />
            </div>
          )}

          <div className="border-t border-gray-200 pt-4">
            <h4 className="font-medium text-gray-900 mb-3">POS Login Password</h4>

            <Toggle
              label="Generate temporary password"
              description="Staff will be required to change it on first login"
              checked={formData.generatePassword}
              onChange={(checked) => setFormData({ ...formData, generatePassword: checked, password: "" })}
            />

            {!formData.generatePassword && (
              <div className="mt-4">
                <Input
                  label="Set Password"
                  type="password"
                  placeholder="Minimum 8 characters"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Must contain uppercase, lowercase, and a number
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="secondary"
              onClick={() => {
                setShowAddModal(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleAddMember} loading={saving}>
              Add Staff
            </Button>
          </div>
        </div>
      </Modal>

      {/* Temporary Password Modal */}
      <Modal
        isOpen={!!showTempPassword}
        onClose={handleCloseTempPassword}
        title="Staff Member Added"
        size="sm"
      >
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
            <Icon icon="solar:check-circle-bold" className="w-8 h-8 text-green-600" />
          </div>

          <p className="text-gray-600 mb-4">
            Share this temporary password with the staff member. They will be required to change it on first login.
          </p>

          <div className="bg-gray-100 rounded-xl p-4 mb-4">
            <p className="text-sm text-gray-500 mb-1">Temporary Password</p>
            <div className="flex items-center justify-center gap-2">
              <code className="text-2xl font-mono font-bold text-gray-900">{showTempPassword}</code>
              <button
                onClick={() => copyToClipboard(showTempPassword!)}
                className="p-2 rounded-lg hover:bg-gray-200 text-gray-600"
              >
                <Icon icon="solar:copy-linear" className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="p-3 bg-amber-50 rounded-lg text-amber-800 text-sm mb-4">
            <Icon icon="solar:danger-triangle-linear" className="w-4 h-4 inline mr-1" />
            This password will not be shown again!
          </div>

          <Button onClick={handleCloseTempPassword} fullWidth>
            Done
          </Button>
        </div>
      </Modal>
    </div>
  );
}
