"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
// Phase I #4 (2026-09-12): reCAPTCHA on invite-accept — server hard-fails
// without a valid token.
import { useRecaptcha } from "@/hooks/useRecaptcha";

interface InviteInfo {
  email: string;
  companyName: string | null;
  contactName: string | null;
  phone: string | null;
  message: string | null;
  expiresAt: string;
  fromBusinessName: string;
}

export default function SupplierAcceptPage({
  params,
}: {
  // Next 15 passes params as a Promise — unwrap with `use()`.
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recaptcha = useRecaptcha();

  // Form state — pre-fill company + contact name from the invite so the
  // supplier only has to add a first/last name split and set a password.
  const [companyName, setCompanyName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/supplier-invites/${token}`);
        // Parse body as text first so a non-JSON error page (Nginx 502,
        // HTML 500) doesn't throw a cryptic parse error and hide the
        // real HTTP status.
        const bodyText = await res.text();
        let data: any = null;
        try {
          data = bodyText ? JSON.parse(bodyText) : null;
        } catch {
          setError(
            `Server error (${res.status}): ${bodyText.slice(0, 200) || "empty response"}`
          );
          return;
        }
        if (!res.ok || !data?.success) {
          // If the API surfaced a technical detail (e.g. Prisma error
          // message), show it — makes ops debugging one-shot instead of
          // requiring a pm2 log dive. Falls back to the friendly text.
          const base = data?.error || "Invitation not available";
          const detail = data?.detail && data.detail !== base ? ` — ${data.detail}` : "";
          setError(`${base}${detail}`);
          return;
        }
        setInvite(data.invite);
        setCompanyName(data.invite.companyName || "");
        // Best-effort split — the merchant may have entered a full name.
        if (data.invite.contactName) {
          const parts = data.invite.contactName.trim().split(/\s+/);
          setFirstName(parts[0] || "");
          setLastName(parts.slice(1).join(" "));
        }
      } catch (e: any) {
        // Network-level failure (offline, TLS, DNS). Include the
        // exception name so we can tell "TypeError: Failed to fetch"
        // apart from other network faults.
        setError(
          `Failed to load invitation${e?.name ? ` — ${e.name}: ${e?.message || "unknown"}` : ""}`
        );
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!companyName.trim() || companyName.trim().length < 2) {
      toast.error("Company name is required");
      return;
    }
    if (!firstName.trim()) {
      toast.error("First name is required");
      return;
    }
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }

    setSubmitting(true);
    try {
      const recaptchaToken = await recaptcha.execute("supplier_invite_accept");
      const res = await fetch(`/api/supplier-invites/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          firstName: firstName.trim(),
          lastName: lastName.trim() || undefined,
          password,
          recaptchaToken,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        toast.error(data.error || "Failed to accept invitation");
        setSubmitting(false);
        return;
      }
      toast.success("Welcome to your supplier portal!");
      // Land them in the supplier portal. The auth cookie is already set by
      // the accept endpoint, so this is a hard nav rather than an SPA push.
      window.location.href = "/supplier";
    } catch {
      toast.error("Failed to accept invitation");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 mx-auto mb-4 flex items-center justify-center">
            <Icon icon="solar:danger-triangle-bold" className="w-7 h-7 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invitation unavailable</h1>
          <p className="text-gray-500 text-sm">
            {error || "This invitation link is no longer valid."}
          </p>
          <p className="text-gray-400 text-xs mt-4">
            If you think this is a mistake, ask the merchant to send a fresh invitation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-lg mx-auto">
        {/* Invite header */}
        <div className="bg-white rounded-2xl shadow-sm p-8 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
              <Icon icon="solar:box-bold" className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold text-gray-900">
                You've been invited
              </h1>
              <p className="text-sm text-gray-500 mt-0.5">
                <strong className="text-gray-700">{invite.fromBusinessName}</strong> wants
                to add you to their supplier network on iTap POS.
              </p>
            </div>
          </div>

          {invite.message && (
            <div className="mt-5 p-4 border-l-4 border-indigo-500 bg-indigo-50 rounded-r-lg">
              <p className="text-sm text-gray-700 italic">&ldquo;{invite.message}&rdquo;</p>
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
                Invited email
              </p>
              <p className="text-gray-900 font-medium mt-0.5">{invite.email}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold">
                Expires
              </p>
              <p className="text-gray-900 font-medium mt-0.5">
                {new Date(invite.expiresAt).toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            </div>
          </div>
        </div>

        {/* Setup form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm p-8 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Set up your supplier account</h2>
            <p className="text-sm text-gray-500 mt-1">
              Create your login. You'll add products and business details after you're in.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Company name
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Fresh Foods Inc."
              required
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                First name
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Last name
              </label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Confirm password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Setting up…" : "Accept & create supplier account"}
          </button>

          <p className="text-xs text-gray-400 text-center">
            By accepting, you agree that <strong>{invite.fromBusinessName}</strong> will be
            added as a customer of your new supplier account. You can pause or terminate
            this relationship any time.
          </p>
        </form>
      </div>
    </div>
  );
}
