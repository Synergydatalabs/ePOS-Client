"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

export default function ActivatePage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"welcome" | "form">("welcome");
  const [businessName, setBusinessName] = useState("");

  const handleStartTrial = async () => {
    if (!businessName.trim()) {
      toast.error("Please enter your business name");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: businessName.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create account");
      }

      toast.success("Welcome to iTAP! Your 14-day trial has started.");
      router.push("/dashboard");
    } catch (error: any) {
      toast.error(error.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-600 via-indigo-600 to-blue-600 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl tap-gradient flex items-center justify-center">
            <Icon icon="solar:point-on-map-bold" className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {step === "welcome" ? "Welcome to iTAP" : "Set Up Your Business"}
          </h1>
          <p className="text-gray-700 mt-2">
            {session?.user?.email}
          </p>
        </div>

        {step === "welcome" ? (
          <>
            {/* Welcome Screen */}
            <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-start gap-3">
                <Icon icon="solar:info-circle-bold" className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-800 font-medium">POS Not Activated</p>
                  <p className="text-amber-700 text-sm mt-1">
                    You don't have access to any POS accounts yet. Start a free trial to begin accepting payments.
                  </p>
                </div>
              </div>
            </div>

            {/* Features */}
            <div className="space-y-4 mb-8">
              <h3 className="font-semibold text-gray-900">What you get with iTAP:</h3>

              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <Icon icon="solar:qr-code-bold" className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">QR-Based Payments</p>
                  <p className="text-sm text-gray-700">Accept payments without expensive terminals</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <Icon icon="solar:cloud-check-bold" className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Works Offline</p>
                  <p className="text-sm text-gray-700">Keep taking orders even without internet</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <Icon icon="solar:users-group-rounded-bold" className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Team Management</p>
                  <p className="text-sm text-gray-700">Add staff with role-based access control</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <Icon icon="solar:leaf-bold" className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <p className="font-medium text-gray-900">Digital Receipts</p>
                  <p className="text-sm text-gray-700">Eco-friendly, no paper waste</p>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <button
                onClick={() => setStep("form")}
                className="w-full py-4 px-6 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all flex items-center justify-center gap-2"
              >
                <Icon icon="solar:rocket-bold" className="w-5 h-5" />
                Start 14-Day Free Trial
              </button>

              <button
                onClick={() => signOut({ callbackUrl: "/signin" })}
                className="w-full py-3 px-6 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all"
              >
                Sign Out
              </button>
            </div>

            <p className="text-center text-xs text-gray-600 mt-6">
              No credit card required. Cancel anytime.
            </p>
          </>
        ) : (
          <>
            {/* Business Setup Form */}
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Business Name
                </label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g., Joe's Coffee Shop"
                  className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                  autoFocus
                />
              </div>

              <div className="p-4 bg-gray-50 rounded-xl">
                <p className="text-sm text-gray-600">
                  <strong>What happens next:</strong>
                </p>
                <ul className="mt-2 space-y-1 text-sm text-gray-700">
                  <li>• Your 14-day trial starts immediately</li>
                  <li>• You'll be set as the business owner</li>
                  <li>• Default location created automatically</li>
                  <li>• Start creating invoices right away</li>
                </ul>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep("welcome")}
                  disabled={loading}
                  className="flex-1 py-3 px-6 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all disabled:opacity-50"
                >
                  Back
                </button>
                <button
                  onClick={handleStartTrial}
                  disabled={loading || !businessName.trim()}
                  className="flex-1 py-3 px-6 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <Icon icon="solar:check-circle-bold" className="w-5 h-5" />
                      Start Trial
                    </>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
