"use client";

// Merchant-facing marketplace index — grid of suppliers this merchant is
// connected to. Click a card → supplier storefront view.
//
// Kept intentionally simple for v1: no public marketplace browse yet
// (that arrives when we launch the "find suppliers" feature). This page
// only shows suppliers already linked via an accepted invite.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Card, Badge } from "@/components/ui";

interface SupplierRow {
  relationshipId: string;
  supplierTenantId: string;
  name: string;
  currency: string;
  aboutText: string | null;
  categories: string[];
  minOrderCents: number;
  defaultLeadDays: number | null;
  productCount: number;
  source: "INVITE" | "MARKETPLACE";
  connectedAt: string;
  totalOrders: number;
}

export default function MarketplacePage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/tenants/${tenantId}/marketplace/suppliers`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setSuppliers(data.suppliers);
        else toast.error(data.error || "Failed to load suppliers");
      })
      .catch(() => toast.error("Failed to load suppliers"))
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (!tenantId) {
    return (
      <div className="p-12 text-center text-gray-500">
        <p>Please select a business first</p>
      </div>
    );
  }

  const money = (cents: number, currency: string) =>
    `${currency} ${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  return (
    <div>
      <AdminHeader
        title="Marketplace"
        subtitle={
          suppliers.length
            ? `${suppliers.length} connected supplier${suppliers.length !== 1 ? "s" : ""}`
            : "Suppliers you've invited (or accepted from) appear here"
        }
        actions={
          <Link
            href="/dashboard/admin/marketplace/orders"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium"
          >
            <Icon icon="solar:clipboard-list-linear" className="w-4 h-4" />
            Your Purchase Orders
          </Link>
        }
      />

      <div className="p-6 max-w-6xl mx-auto">
        {/* How it works banner — mirrors the Terminals page pattern; helps
             set expectations while the marketplace is still small. */}
        <div className="p-5 rounded-2xl bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 border border-indigo-100 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center flex-shrink-0">
              <Icon icon="solar:box-bold" className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-gray-900 mb-1">Order stock from your suppliers</h3>
              <p className="text-sm text-gray-700 mb-2">
                Browse each supplier's catalog to see wholesale prices and minimum order quantities.
                Placing purchase orders directly from here is coming in the next release.
              </p>
              <p className="text-sm text-gray-700">
                Need to invite a new supplier? Go to{" "}
                <Link
                  href="/dashboard/admin/inventory/suppliers"
                  className="text-indigo-700 font-medium hover:underline"
                >
                  Inventory → Suppliers
                </Link>
                .
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <div className="animate-pulse space-y-3">
                  <div className="h-8 bg-gray-100 rounded w-2/3" />
                  <div className="h-4 bg-gray-100 rounded w-1/2" />
                  <div className="h-16 bg-gray-100 rounded" />
                </div>
              </Card>
            ))}
          </div>
        ) : suppliers.length === 0 ? (
          <Card className="text-center py-12">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 mx-auto mb-5 flex items-center justify-center">
              <Icon icon="solar:shop-2-bold" className="w-8 h-8 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No suppliers connected yet
            </h3>
            <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
              Invite a supplier from your Inventory page — once they accept, their catalog
              becomes visible here for you to browse and order from.
            </p>
            <Link
              href="/dashboard/admin/inventory/suppliers"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-medium text-sm hover:bg-indigo-700"
            >
              <Icon icon="solar:letter-opened-bold" className="w-4 h-4" />
              Invite a Supplier
            </Link>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {suppliers.map((s) => (
              <Link
                key={s.relationshipId}
                href={`/dashboard/admin/marketplace/${s.supplierTenantId}`}
                className="block"
              >
                <Card className="hover:border-indigo-300 transition-colors h-full">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                      <Icon icon="solar:shop-bold" className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-gray-900 truncate">{s.name}</h3>
                      <p className="text-xs text-gray-500">
                        {s.productCount} product{s.productCount !== 1 ? "s" : ""} available
                      </p>
                    </div>
                    <Badge variant="success" size="sm">
                      Connected
                    </Badge>
                  </div>

                  {s.aboutText && (
                    <p className="text-sm text-gray-600 line-clamp-2 mb-3">{s.aboutText}</p>
                  )}

                  {s.categories.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {s.categories.slice(0, 4).map((c) => (
                        <span
                          key={c}
                          className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 font-medium"
                        >
                          {c}
                        </span>
                      ))}
                      {s.categories.length > 4 && (
                        <span className="text-[10px] text-gray-400 py-0.5">
                          +{s.categories.length - 4} more
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-4 pt-3 border-t border-gray-100 text-xs text-gray-500">
                    <span>
                      <strong className="text-gray-700">Min order</strong>{" "}
                      {money(s.minOrderCents, s.currency)}
                    </span>
                    {s.defaultLeadDays != null && (
                      <span>
                        <strong className="text-gray-700">Lead</strong> {s.defaultLeadDays}d
                      </span>
                    )}
                    {s.totalOrders > 0 && (
                      <span>
                        <strong className="text-gray-700">{s.totalOrders}</strong> past order
                        {s.totalOrders !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
