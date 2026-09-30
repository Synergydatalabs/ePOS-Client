"use client";

// Phase I #6 (2026-09-18) — Payments API key management.
//
// Suppliers land here to mint bearer keys for the public Payments API.
// Design notes:
//   * Plaintext key is shown ONCE in a modal after creation — never
//     surfaced again. If lost, revoke + mint a new one.
//   * List shows masked "sk_...abcd" with revoke button.
//   * A curl example at the top gives partners a copy-paste starting
//     point (uses the tenant's hostname).

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  keyLast4: string;
  enabled: boolean;
  lastUsedAt: string | null;
  lastUsedIp?: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface CreatedApiKey extends ApiKeyRow {
  plaintext: string;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/supplier/api-keys");
      const json = await res.json();
      if (res.ok) setKeys(json.keys || []);
      else toast.error(json.error || "Failed to load keys");
    } catch {
      toast.error("Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const createKey = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/supplier/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || "Failed to mint key");
        return;
      }
      setCreatedKey(json as CreatedApiKey);
      setShowCreateModal(false);
      setNewKeyName("");
      void loadKeys();
    } catch {
      toast.error("Failed to mint key");
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string, name: string) => {
    if (!confirm(`Revoke "${name}"? This cannot be undone — any partner using this key will start getting 403.`)) return;
    try {
      const res = await fetch(`/api/supplier/api-keys/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Key revoked");
        void loadKeys();
      } else {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || "Failed to revoke");
      }
    } catch {
      toast.error("Failed to revoke");
    }
  };

  const toggleEnabled = async (id: string, next: boolean) => {
    try {
      const res = await fetch(`/api/supplier/api-keys/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) {
        toast.success(next ? "Key enabled" : "Key disabled");
        void loadKeys();
      } else {
        toast.error("Update failed");
      }
    } catch {
      toast.error("Update failed");
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copy failed — select and copy manually");
    }
  };

  return (
    <div className="p-6 lg:p-10 max-w-4xl mx-auto pb-32">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Payments API keys</h1>
          <p className="text-gray-500 mt-1 max-w-2xl">
            Bearer tokens your other systems (websites, back-office apps) use to POST
            payments to us. Each key operates against this tenant&apos;s active Stripe
            processor. We show the plaintext value once — copy and store it in your
            own secret manager.
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 shrink-0"
        >
          <Icon icon="solar:add-square-bold" className="w-4 h-4" />
          New key
        </button>
      </div>

      <div className="bg-indigo-50/50 border border-indigo-200 rounded-2xl p-5 mb-6 space-y-6">
        <div>
          <h2 className="text-sm font-bold text-indigo-900 mb-2 flex items-center gap-2">
            <Icon icon="solar:shield-keyhole-bold" className="w-4 h-4" />
            Tokenized forward (fully your branding — no iframe from us)
          </h2>
          <p className="text-xs text-indigo-800/80 mb-2">
            Step 1 — your frontend fetches our publishable key + tokenizes the card via Stripe.js:
          </p>
          <pre className="text-xs text-indigo-900 bg-white/70 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`// Get publishable key
const cfg = await fetch('https://hub.synergydatalabs.com/api/public/v1/config',
  { headers: { Authorization: 'Bearer <YOUR_KEY>' }}).then(r => r.json());
const stripe = Stripe(cfg.publishable_key);

// Mount your own card inputs (fully branded, no iframe)
const elements = stripe.elements();
const cardNumber = elements.create('cardNumber', { style: yourStyle });
cardNumber.mount('#your-card-input');
// ...cardExpiry, cardCvc similarly

// Tokenize card on submit → get pm_...
const { paymentMethod } = await stripe.createPaymentMethod({
  type: 'card', card: cardNumber,
  billing_details: { name, email }
});`}
          </pre>
          <p className="text-xs text-indigo-800/80 mt-2 mb-2">
            Step 2 — your backend forwards the token to /charge:
          </p>
          <pre className="text-xs text-indigo-900 bg-white/70 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`curl -X POST https://hub.synergydatalabs.com/api/public/v1/payments/charge \\
  -H "Authorization: Bearer <YOUR_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 1000, "currency": "cad",
    "payment_method_id": "pm_1NxYz...",
    "customer": { "email": "buyer@example.com", "name": "Buyer" },
    "description": "Order #42",
    "webhook_url": "https://your-site.com/hooks/payment",
    "webhook_secret": "your-partner-secret",
    "metadata": { "order_id": "42" }
  }'`}
          </pre>
          <p className="text-xs text-indigo-800/80 mt-2">
            Returns <code className="bg-white/70 rounded px-1">status: "succeeded"</code> synchronously (or
            <code className="bg-white/70 rounded px-1">requires_action</code> if 3DS — pass the returned
            <code className="bg-white/70 rounded px-1">client_secret</code> to <code className="bg-white/70 rounded px-1">stripe.handleNextAction()</code>).
            Card data never touches your server — Stripe.js sends it browser→Stripe directly, we get only the token.
          </p>
        </div>

        <div className="border-t border-indigo-200 pt-4">
          <h2 className="text-sm font-bold text-indigo-900 mb-2 flex items-center gap-2">
            <Icon icon="solar:widget-add-bold" className="w-4 h-4" />
            Embedded Stripe Elements (customer stays on YOUR site)
          </h2>
          <p className="text-xs text-indigo-800/80 mb-2">
            Step 1 — your backend calls this to get a <code className="bg-white/70 rounded px-1">client_secret</code>:
          </p>
          <pre className="text-xs text-indigo-900 bg-white/70 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`curl -X POST https://hub.synergydatalabs.com/api/public/v1/payment-intents \\
  -H "Authorization: Bearer <YOUR_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 1000,
    "currency": "cad",
    "customer": { "email": "buyer@example.com", "name": "Buyer" },
    "description": "Order #42",
    "webhook_url": "https://your-site.com/hooks/payment",
    "webhook_secret": "your-partner-secret",
    "webhook_template": "{\\"event\\":\\"{{event.type}}\\",\\"amount\\":{{payment.amount}}}",
    "webhook_events": ["payment.succeeded","payment.failed"],
    "metadata": { "order_id": "42" }
  }'`}
          </pre>
          <p className="text-xs text-indigo-800/80 mt-2 mb-2">
            Step 2 — your frontend mounts the card form. Drop this HTML into your page:
          </p>
          <pre className="text-xs text-indigo-900 bg-white/70 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`<script src="https://js.stripe.com/v3"></script>
<div id="payment-form"></div>
<button id="pay-btn">Pay $10</button>
<script>
  const r = await fetch('/your-backend/create-intent', { method: 'POST' });
  const { client_secret, publishable_key } = await r.json();
  const stripe = Stripe(publishable_key);
  const elements = stripe.elements({ clientSecret: client_secret });
  elements.create('payment').mount('#payment-form');
  document.getElementById('pay-btn').onclick = async () => {
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: 'https://your-site.com/order-complete' },
      redirect: 'if_required',
    });
    if (error) alert(error.message);
    // On success, we'll POST your webhook_url with the outcome.
  };
</script>`}
          </pre>
        </div>

        <div className="border-t border-indigo-200 pt-4">
          <h2 className="text-sm font-bold text-indigo-900 mb-2 flex items-center gap-2">
            <Icon icon="solar:check-circle-bold" className="w-4 h-4" />
            Record a payment (your site charged the card, we just log it)
          </h2>
          <pre className="text-xs text-indigo-900 bg-white/70 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`curl -X POST https://hub.synergydatalabs.com/api/public/v1/payments/record \\
  -H "Authorization: Bearer <YOUR_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 1000,
    "currency": "cad",
    "customer": { "email": "buyer@example.com", "name": "Buyer" },
    "description": "Order #42",
    "external_reference": "sdl_txn_abc123",
    "paid_at": "2026-09-19T02:26:27Z",
    "processor_name": "stripe",
    "metadata": { "order_id": "42" }
  }'`}
          </pre>
          <p className="text-xs text-indigo-800/80 mt-2">
            Returns <code className="bg-white/70 rounded px-1">{"{ id, invoice_number, status: \"paid\", view_url }"}</code>.
            Idempotent on <code className="bg-white/70 rounded px-1">external_reference</code> — sending the same one twice
            returns the original invoice instead of creating a duplicate.
          </p>
        </div>

        <div className="border-t border-indigo-200 pt-4">
          <h2 className="text-sm font-bold text-indigo-900 mb-2 flex items-center gap-2">
            <Icon icon="solar:card-bold" className="w-4 h-4" />
            Hosted checkout (customer visits our page to pay via Stripe)
          </h2>
          <pre className="text-xs text-indigo-900 bg-white/70 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`curl -X POST https://hub.synergydatalabs.com/api/public/v1/payments \\
  -H "Authorization: Bearer <YOUR_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": 1000,
    "currency": "cad",
    "customer": { "email": "buyer@example.com", "name": "Buyer" },
    "description": "Order #42",
    "webhook_url":      "https://your-site.com/hooks/payment",
    "webhook_secret":   "your-partner-secret",
    "webhook_template": "{\\"id\\":\\"{{event.id}}\\",\\"amount\\":{{payment.amount}}}",
    "webhook_events":   ["payment.succeeded", "payment.failed"],
    "metadata":         { "order_id": "42" }
  }'`}
          </pre>
          <p className="text-xs text-indigo-800/80 mt-2">
            Returns <code className="bg-white/70 rounded px-1">checkout_url</code> — redirect the customer there. On
            success or failure we&apos;ll POST your <code className="bg-white/70 rounded px-1">webhook_url</code> with
            the rendered template + HMAC signature.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-500">
          Loading keys…
        </div>
      ) : keys.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 text-center">
          <Icon icon="solar:key-broken" className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No API keys yet.</p>
          <p className="text-sm text-gray-400 mt-1">Mint one to get started.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Key</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Last used</th>
                <th className="px-5 py-3">Created</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {keys.map((k) => {
                const isRevoked = !!k.revokedAt;
                return (
                  <tr key={k.id} className={isRevoked ? "opacity-50" : ""}>
                    <td className="px-5 py-3 font-medium text-gray-900">{k.name}</td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-600">
                      {k.keyPrefix}_…{k.keyLast4}
                    </td>
                    <td className="px-5 py-3">
                      {isRevoked ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">
                          Revoked
                        </span>
                      ) : k.enabled ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium">
                          Active
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {k.lastUsedAt
                        ? new Date(k.lastUsedAt).toLocaleString()
                        : <span className="text-gray-400">Never</span>}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {new Date(k.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {!isRevoked && (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => toggleEnabled(k.id, !k.enabled)}
                            className="text-xs text-gray-500 hover:text-gray-800 underline"
                          >
                            {k.enabled ? "Disable" : "Enable"}
                          </button>
                          <button
                            onClick={() => revokeKey(k.id, k.name)}
                            className="text-xs text-red-600 hover:text-red-800 underline"
                          >
                            Revoke
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">Mint a new API key</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Key name
                </label>
                <input
                  type="text"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="SDL production website"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                  autoFocus
                />
                <p className="text-xs text-gray-400 mt-1">
                  A label that helps you remember which system uses this key.
                </p>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewKeyName("");
                }}
                className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={createKey}
                disabled={creating}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-60"
              >
                {creating ? "Minting…" : "Mint key"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copy-once modal — plaintext is unrecoverable after this */}
      {createdKey && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">
            <div className="p-5 border-b border-gray-100 flex items-center gap-2">
              <Icon icon="solar:key-square-2-bold" className="w-5 h-5 text-indigo-600" />
              <h3 className="text-lg font-bold text-gray-900">Copy your key now</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
                This is the only time we&apos;ll show the plaintext value. If you
                lose it, revoke the key and mint a new one.
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  {createdKey.name}
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-xs bg-gray-50 border border-gray-200 rounded-lg p-3 break-all">
                    {createdKey.plaintext}
                  </code>
                  <button
                    onClick={() => copyToClipboard(createdKey.plaintext)}
                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 whitespace-nowrap flex items-center gap-1.5"
                  >
                    <Icon icon={copied ? "solar:check-circle-bold" : "solar:copy-bold"} className="w-4 h-4" />
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setCreatedKey(null)}
                className="px-4 py-2 rounded-lg bg-gray-900 text-white font-semibold hover:bg-gray-800"
              >
                I&apos;ve saved it — close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
