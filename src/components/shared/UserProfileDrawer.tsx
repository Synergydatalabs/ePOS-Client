"use client";

// UserProfileDrawer — one component, four shells (POS, admin, partner
// dashboard, supplier portal). Slides in from the right; shows the user's
// name/email/tenant, lets them edit their name, and — for local/partner
// auth — change their password.
//
// Cognito users get a helper message pointing them at Cognito's own
// password flow (we don't manage their password hash).
//
// The parent decides what triggers the drawer — typically a click on the
// user's avatar/name in the sidebar footer. The `onSignOut` callback lets
// each shell run its own sign-out logic (routes differ between merchant
// admin, partner, POS, supplier).

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface Profile {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  authType: "cognito" | "partner";
  lastActiveAt: string | null;
}

interface TenantSummary {
  id: string;
  name: string;
  businessType: string | null;
}

export interface UserProfileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Called when the user clicks "Sign out" inside the drawer.
   * Each shell has different sign-out semantics (Cognito signOut vs partner
   * cookie clear vs POS token clear), so the parent handles it.
   */
  onSignOut: () => void;
}

export default function UserProfileDrawer({
  isOpen,
  onClose,
  onSignOut,
}: UserProfileDrawerProps) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [tenant, setTenant] = useState<TenantSummary | null>(null);

  // Edit-name state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameDirty, setNameDirty] = useState(false);

  // Change-password state
  const [showPwSection, setShowPwSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  // Load profile every time the drawer opens — cheap, keeps values fresh
  // if the user's name changed in another tab.
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setShowPwSection(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");

    const activeTenantId =
      typeof window !== "undefined"
        ? localStorage.getItem("tap_active_tenant")
        : null;

    fetch("/api/me/profile", {
      headers: activeTenantId ? { "x-active-tenant": activeTenantId } : {},
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setProfile(data.profile);
          setTenant(data.tenant);
          setFirstName(data.profile.firstName || "");
          setLastName(data.profile.lastName || "");
          setNameDirty(false);
        } else {
          toast.error(data.error || "Failed to load profile");
        }
      })
      .catch(() => toast.error("Failed to load profile"))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // ESC closes the drawer — small touch that makes it feel right.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const saveName = async () => {
    setSavingName(true);
    try {
      const res = await fetch("/api/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Name updated");
        setProfile((p) => (p ? { ...p, firstName: data.profile.firstName, lastName: data.profile.lastName } : p));
        setNameDirty(false);
      } else {
        toast.error(data.error || "Failed to update");
      }
    } catch {
      toast.error("Failed to update");
    } finally {
      setSavingName(false);
    }
  };

  const changePassword = async () => {
    if (!currentPassword) {
      toast.error("Enter your current password");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords don't match");
      return;
    }

    setChangingPw(true);
    try {
      const res = await fetch("/api/me/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success("Password changed");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setShowPwSection(false);
      } else {
        toast.error(data.error || "Failed to change password");
      }
    } catch {
      toast.error("Failed to change password");
    } finally {
      setChangingPw(false);
    }
  };

  const initials =
    ((profile?.firstName?.[0] || "") + (profile?.lastName?.[0] || "")) ||
    profile?.email?.[0]?.toUpperCase() ||
    "U";

  const roleLabel: Record<string, string> = {
    TENANT_OWNER: "Owner",
    TENANT_ADMIN: "Admin",
    POS_ADMIN: "POS Admin",
    POS_STAFF: "Staff",
    KITCHEN_STAFF: "Kitchen",
  };

  // Two visual pieces: backdrop (dim) + drawer (slides in from right).
  // Both mount unconditionally so the transition animates on open/close.
  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 z-50 transition-opacity ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className={`fixed top-0 right-0 h-full w-full sm:w-[420px] bg-white z-50 shadow-2xl transform transition-transform overflow-y-auto ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-900">Your account</h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 -mt-2 -mr-2"
              aria-label="Close"
            >
              <Icon icon="solar:close-circle-linear" className="w-6 h-6" />
            </button>
          </div>

          {loading || !profile ? (
            <div className="animate-pulse space-y-4">
              <div className="h-16 bg-gray-100 rounded-2xl" />
              <div className="h-32 bg-gray-100 rounded-2xl" />
              <div className="h-24 bg-gray-100 rounded-2xl" />
            </div>
          ) : (
            <>
              {/* Identity tile */}
              <div className="flex items-center gap-4 mb-6 p-4 rounded-2xl bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 border border-indigo-100">
                <div className="w-14 h-14 rounded-full bg-white flex items-center justify-center font-bold text-indigo-700 text-lg flex-shrink-0 shadow-sm">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 truncate">
                    {[profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
                      profile.email}
                  </p>
                  <p className="text-sm text-gray-600 truncate">{profile.email}</p>
                  <div className="mt-1.5 flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-white text-indigo-700 font-medium border border-indigo-100">
                      {roleLabel[profile.role] || profile.role}
                    </span>
                    {tenant && (
                      <span className="text-gray-500 truncate">at {tenant.name}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Edit name */}
              <section className="mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wide">
                  Your name
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">First</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => {
                        setFirstName(e.target.value);
                        setNameDirty(true);
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Last</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => {
                        setLastName(e.target.value);
                        setNameDirty(true);
                      }}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm"
                    />
                  </div>
                </div>
                {nameDirty && (
                  <button
                    onClick={saveName}
                    disabled={savingName || !firstName.trim()}
                    className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
                  >
                    <Icon icon="solar:diskette-linear" className="w-4 h-4" />
                    {savingName ? "Saving…" : "Save Name"}
                  </button>
                )}
              </section>

              {/* Change password — only for partner/local auth */}
              <section className="mb-6">
                <h3 className="text-sm font-semibold text-gray-900 mb-3 uppercase tracking-wide">
                  Password
                </h3>
                {profile.authType === "cognito" ? (
                  <div className="p-3 rounded-xl bg-gray-50 border border-gray-200 text-sm text-gray-600">
                    <div className="flex items-start gap-2">
                      <Icon
                        icon="solar:info-circle-bold"
                        className="w-4 h-4 mt-0.5 text-gray-400 flex-shrink-0"
                      />
                      <span>
                        Your password is managed by our identity provider. Use{" "}
                        <a href="/api/auth/signin" className="text-indigo-600 hover:underline">
                          the sign-in flow
                        </a>{" "}
                        to reset it.
                      </span>
                    </div>
                  </div>
                ) : !showPwSection ? (
                  <button
                    onClick={() => setShowPwSection(true)}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 text-gray-700 text-sm font-medium hover:bg-gray-50"
                  >
                    <Icon icon="solar:lock-password-linear" className="w-4 h-4" />
                    Change Password
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Current password
                      </label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        New password
                      </label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="8+ chars, mixed case, at least 1 number"
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Confirm new password
                      </label>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none text-sm"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={changePassword}
                        disabled={changingPw}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
                      >
                        {changingPw ? "Updating…" : "Update Password"}
                      </button>
                      <button
                        onClick={() => {
                          setShowPwSection(false);
                          setCurrentPassword("");
                          setNewPassword("");
                          setConfirmPassword("");
                        }}
                        className="px-4 py-2 rounded-lg text-gray-600 text-sm hover:bg-gray-100"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {/* Sign out */}
              <section className="pt-4 border-t border-gray-100">
                <button
                  onClick={() => {
                    onClose();
                    onSignOut();
                  }}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-red-600 border border-red-200 hover:bg-red-50 font-medium"
                >
                  <Icon icon="solar:logout-2-bold" className="w-5 h-5" />
                  Sign Out
                </button>
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
