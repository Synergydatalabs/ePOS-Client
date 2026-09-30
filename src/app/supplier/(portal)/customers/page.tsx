"use client";

import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";

interface CustomerRow {
  id: string;
  merchant: { id: string; name: string; slug: string; businessType: string };
  status: "ACTIVE" | "PAUSED" | "TERMINATED";
  source: "INVITE" | "MARKETPLACE";
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  totalOrders: number;
  totalSpentCents: number;
  connectedAt: string;
}

const BUSINESS_ICONS: Record<string, string> = {
  restaurant: "solar:chef-hat-bold",
  salon: "solar:scissors-bold",
  retail: "solar:bag-4-bold",
  cab: "solar:car-bold",
};

export default function SupplierCustomersPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/supplier/customers")
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setCustomers(json.customers);
      })
      .finally(() => setLoading(false));
  }, []);

  const activeCount = customers.filter((c) => c.status === "ACTIVE").length;

  return (
    <div className="p-6 lg:p-10 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">Customers</h1>
        <p className="text-gray-500 mt-1">
          Merchants connected to your supplier account.{" "}
          <span className="font-medium text-gray-700">{activeCount} active</span>.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <Icon icon="solar:shop-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            No customers yet
          </h3>
          <p className="text-gray-500 text-sm max-w-md mx-auto">
            Once merchants connect to your supplier account (via invite or by finding
            you in the marketplace), they'll show up here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {customers.map((row) => (
            <div
              key={row.id}
              className="bg-white rounded-2xl border border-gray-200 p-5 hover:border-gray-300 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                  <Icon
                    icon={BUSINESS_ICONS[row.merchant.businessType] || "solar:shop-bold"}
                    className="w-5 h-5 text-white"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-gray-900">{row.merchant.name}</h3>
                    {row.status === "ACTIVE" ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                        Active
                      </span>
                    ) : row.status === "PAUSED" ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-medium">
                        Paused
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                        Terminated
                      </span>
                    )}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium">
                      {row.source === "INVITE" ? "Invited" : "Marketplace"}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-6 text-sm text-gray-500 flex-wrap">
                    <span>
                      <strong className="text-gray-700">{row.totalOrders}</strong> orders
                    </span>
                    <span>
                      <strong className="text-gray-700">
                        ${(row.totalSpentCents / 100).toFixed(2)}
                      </strong>{" "}
                      spent
                    </span>
                    <span>
                      Connected{" "}
                      <span className="text-gray-700">
                        {new Date(row.connectedAt).toLocaleDateString()}
                      </span>
                    </span>
                    {row.lastOrderAt && (
                      <span>
                        Last order{" "}
                        <span className="text-gray-700">
                          {new Date(row.lastOrderAt).toLocaleDateString()}
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
