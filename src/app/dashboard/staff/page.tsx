"use client";

import { useEffect, useState, useCallback } from "react";
import { Icon } from "@iconify/react";
import { format } from "date-fns";
import { toast } from "sonner";
import StaffScheduleModal from "@/components/staff/StaffScheduleModal";

interface Member {
  id: string;
  userSub: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
  status: string;
  hasPassword?: boolean;
  mustChangePassword?: boolean;
  createdAt: string;
  lastActiveAt?: string;
}

const ROLES = [
  { value: "TENANT_OWNER", label: "Owner", description: "Full access to everything" },
  { value: "POS_ADMIN", label: "Admin", description: "Manage settings and staff" },
  { value: "POS_MANAGER", label: "Manager", description: "View reports, manage orders" },
  { value: "POS_STAFF", label: "Staff", description: "POS counter access" },
  { value: "KITCHEN_STAFF", label: "Kitchen", description: "Kitchen display only" },
];

export default function StaffPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showTempPassword, setShowTempPassword] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Phase E R1: schedule + time-off editor per staff row.
  const [scheduleMember, setScheduleMember] = useState<Member | null>(null);

  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    role: "POS_STAFF",
    password: "",
    generatePassword: true,
  });

  useEffect(() => {
    const storedTenant = localStorage.getItem("tap_active_tenant");
    if (storedTenant) setTenantId(storedTenant);
  }, []);

  const fetchMembers = useCallback(async () => {
    if (!tenantId) return;

    try {
      const response = await fetch(`/api/tenants/${tenantId}/members`);
      const data = await response.json();

      if (data.success) {
        setMembers(data.members);
      }
    } catch (error) {
      console.error("Failed to fetch members:", error);
      toast.error("Failed to load team members");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const resetForm = () => {
    setFormData({
      email: "",
      firstName: "",
      lastName: "",
      role: "POS_STAFF",
      password: "",
      generatePassword: true,
    });
  };

  const handleInvite = async () => {
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
        toast.success("Staff member added!");
        setShowInviteModal(false);
        resetForm();
      }

      fetchMembers();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleCloseTempPassword = () => {
    setShowTempPassword(null);
    setShowInviteModal(false);
    resetForm();
  };

  const handleRemove = async (memberId: string, email: string) => {
    if (!confirm(`Remove ${email} from your team?`)) return;

    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/members/${memberId}`,
        {
          method: "DELETE",
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to remove member");
      }

      toast.success("Member removed");
      fetchMembers();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const handleUpdateRole = async (memberId: string, newRole: string) => {
    try {
      const response = await fetch(
        `/api/tenants/${tenantId}/members/${memberId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: newRole }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to update role");
      }

      toast.success("Role updated");
      fetchMembers();
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "TENANT_OWNER":
        return "bg-purple-100 text-purple-700";
      case "POS_ADMIN":
        return "bg-blue-100 text-blue-700";
      case "POS_MANAGER":
        return "bg-green-100 text-green-700";
      case "POS_STAFF":
        return "bg-gray-100 text-gray-700";
      case "KITCHEN_STAFF":
        return "bg-amber-100 text-amber-700";
      default:
        return "bg-gray-100 text-gray-700";
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff</h1>
          <p className="text-gray-500">Manage your team members and POS access</p>
        </div>

        <button
          onClick={() => setShowInviteModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all"
        >
          <Icon icon="solar:user-plus-bold" className="w-5 h-5" />
          <span>Add Staff</span>
        </button>
      </div>

      {/* POS Login Info */}
      {members.length > 0 && (
        <div className="p-4 bg-indigo-50 rounded-xl">
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
      )}

      {/* Members List */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {members.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {members.map((member) => (
              <div
                key={member.id}
                className="p-4 flex items-center justify-between"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold text-lg">
                    {member.firstName
                      ? member.firstName[0].toUpperCase()
                      : member.email[0].toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-gray-900">
                        {member.firstName && member.lastName
                          ? `${member.firstName} ${member.lastName}`
                          : member.email.split("@")[0]}
                      </p>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${getRoleColor(
                          member.role
                        )}`}
                      >
                        {getRoleLabel(member.role)}
                      </span>
                      {member.hasPassword && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 flex items-center gap-1">
                          <Icon icon="solar:key-linear" className="w-3 h-3" />
                          POS Access
                        </span>
                      )}
                      {member.mustChangePassword && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                          Needs Password Reset
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">{member.email}</p>
                    {member.lastActiveAt && (
                      <p className="text-xs text-gray-400">
                        Active {format(new Date(member.lastActiveAt), "MMM d, h:mm a")}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Schedule + time-off editor — Phase E R1. Shown for
                      all roles that can be assigned to an appointment
                      (i.e. anyone but kitchen). Owners can have a
                      schedule too since small-salon owners are often the
                      technician themselves. */}
                  {member.role !== "KITCHEN_STAFF" && (
                    <button
                      onClick={() => setScheduleMember(member)}
                      className="p-2 rounded-lg text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                      title="Schedule & time off"
                    >
                      <Icon icon="solar:calendar-linear" className="w-5 h-5" />
                    </button>
                  )}
                  {member.role !== "TENANT_OWNER" && (
                    <>
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
                        className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Remove member"
                      >
                        <Icon icon="solar:trash-bin-2-linear" className="w-5 h-5" />
                      </button>
                    </>
                  )}
                  {member.role === "TENANT_OWNER" && (
                    <span className="text-sm text-gray-400">Owner</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <Icon icon="solar:users-group-rounded-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No team members</h3>
            <p className="text-gray-500 mb-6">Add staff to help manage your business</p>
            <button
              onClick={() => setShowInviteModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all"
            >
              <Icon icon="solar:user-plus-bold" className="w-5 h-5" />
              Add Staff
            </button>
          </div>
        )}
      </div>

      {/* Role Descriptions */}
      <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Role Permissions</h3>
        <div className="grid gap-3">
          {ROLES.map((role) => (
            <div key={role.value} className="flex items-start gap-3">
              <span
                className={`px-2 py-1 rounded-lg text-xs font-medium ${getRoleColor(
                  role.value
                )}`}
              >
                {role.label}
              </span>
              <p className="text-sm text-gray-600">{role.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && !showTempPassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">Add Staff Member</h2>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  resetForm();
                }}
                className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Icon icon="solar:close-circle-linear" className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  placeholder="staff@example.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    placeholder="John"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    placeholder="Doe"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Role
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                >
                  {ROLES.filter((r) => r.value !== "TENANT_OWNER").map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label} - {role.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Password Section */}
              <div className="border-t border-gray-200 pt-4">
                <h4 className="font-medium text-gray-900 mb-3">POS Login Password</h4>

                <label className="flex items-start gap-3 cursor-pointer">
                  <div className="relative mt-0.5">
                    <input
                      type="checkbox"
                      checked={formData.generatePassword}
                      onChange={(e) => setFormData({ ...formData, generatePassword: e.target.checked, password: "" })}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">Generate temporary password</p>
                    <p className="text-xs text-gray-500">Staff will be required to change it on first login</p>
                  </div>
                </label>

                {!formData.generatePassword && (
                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Set Password
                    </label>
                    <input
                      type="password"
                      placeholder="Minimum 8 characters"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-gray-900"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Must contain uppercase, lowercase, and a number
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setShowInviteModal(false);
                    resetForm();
                  }}
                  className="flex-1 py-2 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleInvite}
                  disabled={saving || !formData.email}
                  className="flex-1 py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saving ? (
                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                  ) : (
                    <>
                      <Icon icon="solar:user-plus-bold" className="w-5 h-5" />
                      Add Staff
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Temporary Password Modal */}
      {showTempPassword && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
              <Icon icon="solar:check-circle-bold" className="w-8 h-8 text-green-600" />
            </div>

            <h2 className="text-xl font-bold text-gray-900 mb-2">Staff Member Added</h2>

            <p className="text-gray-600 mb-4">
              Share this temporary password with the staff member. They will be required to change it on first login.
            </p>

            <div className="bg-gray-100 rounded-xl p-4 mb-4">
              <p className="text-sm text-gray-500 mb-1">Temporary Password</p>
              <div className="flex items-center justify-center gap-2">
                <code className="text-2xl font-mono font-bold text-gray-900">{showTempPassword}</code>
                <button
                  onClick={() => copyToClipboard(showTempPassword)}
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

            <button
              onClick={handleCloseTempPassword}
              className="w-full py-2 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Schedule + time-off editor — Phase E R1 */}
      {scheduleMember && tenantId && (
        <StaffScheduleModal
          tenantId={tenantId}
          staffId={scheduleMember.id}
          staffName={
            scheduleMember.firstName && scheduleMember.lastName
              ? `${scheduleMember.firstName} ${scheduleMember.lastName}`
              : scheduleMember.email
          }
          isOpen={!!scheduleMember}
          onClose={() => setScheduleMember(null)}
        />
      )}
    </div>
  );
}
