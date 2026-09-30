"use client";

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number; // in cents
}

interface TenantSettings {
  taxRate: number;
  tipPresets: number[];
  currency: string;
}

export default function NewInvoicePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"items" | "tip" | "payment">("items");
  const [settings, setSettings] = useState<TenantSettings>({
    taxRate: 13,
    tipPresets: [15, 18, 20],
    currency: "CAD",
  });

  // Invoice data
  const [items, setItems] = useState<LineItem[]>([
    { id: "1", description: "", quantity: 1, unitPrice: 0 },
  ]);
  const [orderReference, setOrderReference] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");

  // Tip data
  const [selectedTip, setSelectedTip] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");

  // Created invoice
  const [createdInvoice, setCreatedInvoice] = useState<any>(null);

  useEffect(() => {
    // Fetch tenant settings
    const tenantId = localStorage.getItem("tap_active_tenant");
    if (tenantId) {
      // For now, use defaults - will fetch from settings API
    }
  }, []);

  const subtotal = items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0
  );
  const taxAmount = Math.round(subtotal * (settings.taxRate / 100));
  const tipAmount =
    selectedTip !== null
      ? selectedTip
      : customTip
      ? Math.round(parseFloat(customTip) * 100)
      : 0;
  const total = subtotal + taxAmount + tipAmount;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: settings.currency,
    }).format(amount / 100);
  };

  const addItem = () => {
    setItems([
      ...items,
      {
        id: Date.now().toString(),
        description: "",
        quantity: 1,
        unitPrice: 0,
      },
    ]);
  };

  const removeItem = (id: string) => {
    if (items.length === 1) return;
    setItems(items.filter((item) => item.id !== id));
  };

  const updateItem = (id: string, field: keyof LineItem, value: any) => {
    setItems(
      items.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const handleCreateInvoice = async () => {
    if (subtotal === 0) {
      toast.error("Please add at least one item");
      return;
    }

    setLoading(true);

    const tenantId = localStorage.getItem("tap_active_tenant");
    if (!tenantId) {
      toast.error("No active business selected");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch(`/api/tenants/${tenantId}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items
            .filter((item) => item.description && item.unitPrice > 0)
            .map((item) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
            })),
          orderReference: orderReference || undefined,
          customerName: customerName || undefined,
          customerEmail: customerEmail || undefined,
          notes: notes || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create invoice");
      }

      setCreatedInvoice(data.invoice);
      setStep("tip");
      toast.success("Invoice created");
    } catch (error: any) {
      toast.error(error.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleAddTip = async () => {
    if (!createdInvoice) return;

    const tenantId = localStorage.getItem("tap_active_tenant");
    if (!tenantId) return;

    setLoading(true);

    try {
      await fetch(
        `/api/tenants/${tenantId}/invoices/${createdInvoice.id}/tip`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tipAmount }),
        }
      );

      setStep("payment");
    } catch (error) {
      console.error("Failed to add tip:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSkipTip = () => {
    setSelectedTip(0);
    setCustomTip("");
    setStep("payment");
  };

  const handlePayment = async (method: "qr" | "cash") => {
    if (!createdInvoice) return;

    const tenantId = localStorage.getItem("tap_active_tenant");
    if (!tenantId) return;

    setLoading(true);

    try {
      if (method === "cash") {
        // Mark as paid with cash
        await fetch(
          `/api/tenants/${tenantId}/invoices/${createdInvoice.id}/pay-cash`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }
        );

        toast.success("Payment recorded!");
        router.push(`/dashboard/invoices/${createdInvoice.id}`);
      } else {
        // Generate QR payment session and go to customer display
        const response = await fetch(
          `/api/tenants/${tenantId}/invoices/${createdInvoice.id}/payment-session`,
          {
            method: "POST",
          }
        );

        const data = await response.json();

        if (data.success) {
          // Open customer display in new tab or navigate
          router.push(`/dashboard/display?invoice=${createdInvoice.id}`);
        }
      }
    } catch (error) {
      toast.error("Failed to process payment");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => {
            if (step === "tip") setStep("items");
            else if (step === "payment") setStep("tip");
            else router.back();
          }}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <Icon icon="solar:arrow-left-linear" className="w-6 h-6" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {step === "items"
              ? "New Invoice"
              : step === "tip"
              ? "Add Tip"
              : "Payment"}
          </h1>
          <p className="text-gray-500">
            {step === "items"
              ? "Add items to your invoice"
              : step === "tip"
              ? "Customer tip selection"
              : "Choose payment method"}
          </p>
        </div>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 mb-8">
        {["Items", "Tip", "Payment"].map((label, index) => {
          const stepIndex = ["items", "tip", "payment"].indexOf(step);
          const isActive = index === stepIndex;
          const isComplete = index < stepIndex;

          return (
            <div key={label} className="flex-1 flex items-center">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                  isActive
                    ? "bg-teal-600 text-white"
                    : isComplete
                    ? "bg-teal-100 text-teal-700"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                {isComplete ? (
                  <Icon icon="solar:check-circle-bold" className="w-5 h-5" />
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={`ml-2 text-sm ${
                  isActive
                    ? "text-teal-700 font-medium"
                    : "text-gray-400"
                }`}
              >
                {label}
              </span>
              {index < 2 && (
                <div className="flex-1 h-0.5 bg-gray-200 mx-2" />
              )}
            </div>
          );
        })}
      </div>

      {/* Step: Items */}
      {step === "items" && (
        <div className="space-y-6">
          {/* Line Items */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Line Items
            </h2>

            <div className="space-y-4">
              {items.map((item, index) => (
                <div key={item.id} className="flex gap-3">
                  <div className="flex-1">
                    <input
                      type="text"
                      placeholder="Item description"
                      value={item.description}
                      onChange={(e) =>
                        updateItem(item.id, "description", e.target.value)
                      }
                      className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                    />
                  </div>
                  <div className="w-20">
                    <input
                      type="number"
                      placeholder="Qty"
                      min={1}
                      value={item.quantity}
                      onChange={(e) =>
                        updateItem(
                          item.id,
                          "quantity",
                          parseInt(e.target.value) || 1
                        )
                      }
                      className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-center"
                    />
                  </div>
                  <div className="w-28">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                        $
                      </span>
                      <input
                        type="number"
                        placeholder="0.00"
                        step="0.01"
                        min={0}
                        value={item.unitPrice ? (item.unitPrice / 100).toFixed(2) : ""}
                        onChange={(e) =>
                          updateItem(
                            item.id,
                            "unitPrice",
                            Math.round(parseFloat(e.target.value || "0") * 100)
                          )
                        }
                        className="w-full pl-7 pr-3 py-2 rounded-xl border border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => removeItem(item.id)}
                    disabled={items.length === 1}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:hover:text-gray-400 disabled:hover:bg-transparent transition-colors"
                  >
                    <Icon icon="solar:trash-bin-2-linear" className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={addItem}
              className="mt-4 w-full py-2 rounded-xl border-2 border-dashed border-gray-200 text-gray-500 hover:border-teal-500 hover:text-teal-600 transition-colors flex items-center justify-center gap-2"
            >
              <Icon icon="solar:add-circle-linear" className="w-5 h-5" />
              Add Item
            </button>
          </div>

          {/* Optional Details */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              Optional Details
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Order Reference
                </label>
                <input
                  type="text"
                  placeholder="Table 5, Order #123"
                  value={orderReference}
                  onChange={(e) => setOrderReference(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer Name
                </label>
                <input
                  type="text"
                  placeholder="John Doe"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Customer Email (for receipt)
                </label>
                <input
                  type="email"
                  placeholder="john@example.com"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  placeholder="Additional notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all resize-none"
                />
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <div className="space-y-3">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Tax ({settings.taxRate}%)</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
              <div className="h-px bg-gray-200" />
              <div className="flex justify-between text-lg font-semibold text-gray-900">
                <span>Total</span>
                <span>{formatCurrency(subtotal + taxAmount)}</span>
              </div>
            </div>

            <button
              onClick={handleCreateInvoice}
              disabled={loading || subtotal === 0}
              className="mt-6 w-full py-3 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                  Creating...
                </>
              ) : (
                <>
                  <Icon icon="solar:arrow-right-bold" className="w-5 h-5" />
                  Continue to Tip
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step: Tip Selection */}
      {step === "tip" && createdInvoice && (
        <div className="space-y-6">
          {/* Invoice Summary */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm text-center">
            <p className="text-gray-500 mb-1">Invoice Total</p>
            <p className="text-4xl font-bold text-gray-900">
              {formatCurrency(createdInvoice.total)}
            </p>
            <p className="text-sm text-gray-500 mt-2">
              {createdInvoice.invoiceNumber}
            </p>
          </div>

          {/* Tip Options */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 text-center">
              Would you like to add a tip?
            </h2>

            <div className="grid grid-cols-3 gap-3 mb-4">
              {settings.tipPresets.map((percent) => {
                const amount = Math.round(createdInvoice.subtotal * (percent / 100));
                const isSelected = selectedTip === amount;

                return (
                  <button
                    key={percent}
                    onClick={() => {
                      setSelectedTip(amount);
                      setCustomTip("");
                    }}
                    className={`py-4 rounded-xl border-2 transition-all ${
                      isSelected
                        ? "border-teal-500 bg-teal-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <p className={`text-2xl font-bold ${isSelected ? "text-teal-600" : "text-gray-900"}`}>
                      {percent}%
                    </p>
                    <p className={`text-sm ${isSelected ? "text-teal-600" : "text-gray-500"}`}>
                      {formatCurrency(amount)}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Custom Tip */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2 text-center">
                Or enter custom amount
              </label>
              <div className="relative max-w-xs mx-auto">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg">
                  $
                </span>
                <input
                  type="number"
                  placeholder="0.00"
                  step="0.01"
                  min={0}
                  value={customTip}
                  onChange={(e) => {
                    setCustomTip(e.target.value);
                    setSelectedTip(null);
                  }}
                  className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all text-center text-lg"
                />
              </div>
            </div>

            {/* New Total */}
            {tipAmount > 0 && (
              <div className="p-4 bg-gray-50 rounded-xl mb-6">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal + Tax</span>
                  <span>{formatCurrency(createdInvoice.total)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Tip</span>
                  <span>{formatCurrency(tipAmount)}</span>
                </div>
                <div className="h-px bg-gray-200 my-2" />
                <div className="flex justify-between font-semibold text-gray-900">
                  <span>New Total</span>
                  <span>{formatCurrency(createdInvoice.total + tipAmount)}</span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleSkipTip}
                className="flex-1 py-3 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all"
              >
                No Tip
              </button>
              <button
                onClick={handleAddTip}
                disabled={loading || tipAmount === 0}
                className="flex-1 py-3 rounded-xl font-semibold text-white tap-gradient hover:opacity-90 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    <Icon icon="solar:check-circle-bold" className="w-5 h-5" />
                    Add Tip
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Payment */}
      {step === "payment" && createdInvoice && (
        <div className="space-y-6">
          {/* Final Total */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm text-center">
            <p className="text-gray-500 mb-1">Amount Due</p>
            <p className="text-5xl font-bold text-gray-900">
              {formatCurrency(createdInvoice.total + tipAmount)}
            </p>
            {tipAmount > 0 && (
              <p className="text-sm text-teal-600 mt-2">
                Includes {formatCurrency(tipAmount)} tip
              </p>
            )}
          </div>

          {/* Payment Methods */}
          <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 text-center">
              Choose Payment Method
            </h2>

            <div className="space-y-3">
              {/* QR Payment */}
              <button
                onClick={() => handlePayment("qr")}
                disabled={loading}
                className="w-full p-4 rounded-xl border-2 border-teal-500 bg-teal-50 hover:bg-teal-100 transition-all flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center">
                  <Icon icon="solar:qr-code-bold" className="w-6 h-6 text-teal-600" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-gray-900">Pay with QR Code</p>
                  <p className="text-sm text-gray-500">
                    Customer scans QR to pay via iTip
                  </p>
                </div>
                <Icon icon="solar:arrow-right-linear" className="w-5 h-5 text-teal-600" />
              </button>

              {/* Cash Payment */}
              <button
                onClick={() => handlePayment("cash")}
                disabled={loading}
                className="w-full p-4 rounded-xl border-2 border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
                  <Icon icon="solar:wallet-money-bold" className="w-6 h-6 text-gray-600" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-gray-900">Pay with Cash</p>
                  <p className="text-sm text-gray-500">
                    Mark as paid by cash
                  </p>
                </div>
                <Icon icon="solar:arrow-right-linear" className="w-5 h-5 text-gray-400" />
              </button>

              {/* External Payment */}
              <button
                onClick={() => handlePayment("cash")}
                disabled={loading}
                className="w-full p-4 rounded-xl border-2 border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all flex items-center gap-4"
              >
                <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center">
                  <Icon icon="solar:card-bold" className="w-6 h-6 text-gray-600" />
                </div>
                <div className="flex-1 text-left">
                  <p className="font-semibold text-gray-900">Other Payment</p>
                  <p className="text-sm text-gray-500">
                    Card terminal, bank transfer, etc.
                  </p>
                </div>
                <Icon icon="solar:arrow-right-linear" className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>

          {/* Cancel */}
          <button
            onClick={() => router.push(`/dashboard/invoices/${createdInvoice.id}`)}
            className="w-full py-3 rounded-xl font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-all"
          >
            Save Invoice & Pay Later
          </button>
        </div>
      )}
    </div>
  );
}
