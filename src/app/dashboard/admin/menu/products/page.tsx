"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Select, Badge, Card } from "@/components/ui";

interface Product {
  id: string;
  name: string;
  description?: string;
  sku?: string;
  basePrice: number;
  costPrice: number;
  imageUrl?: string;
  isActive: boolean;
  isAvailable: boolean;
  // Two duration columns exist in the DB: `prepTimeMinutes` (the field
  // the salon "Service Duration" form + public booking + appointment
  // modal all use) and the older `durationMinutes` (unused now). Prefer
  // prepTimeMinutes on the list so edits show up immediately; fall back
  // to durationMinutes for any legacy row that never got re-saved.
  prepTimeMinutes?: number | null;
  durationMinutes?: number | null;
  requiresTechnician?: boolean;
  category?: { id: string; name: string };
  variants?: any[];
  productAllergens?: { allergen: { name: string; icon: string } }[];
}

interface Category {
  id: string;
  name: string;
}

export default function ProductsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [currency, setCurrency] = useState("CAD");
  const [businessType, setBusinessType] = useState("restaurant");

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;

    try {
      const [productsRes, categoriesRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/products?includeInactive=true&includeUnavailable=true`),
        fetch(`/api/tenants/${tenantId}/categories`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);

      const [productsData, categoriesData, settingsData] = await Promise.all([
        productsRes.json(),
        categoriesRes.json(),
        settingsRes.json(),
      ]);

      if (productsData.success) setProducts(productsData.products);
      if (categoriesData.success) setCategories(categoriesData.categories);
      if (settingsData.success) {
        setCurrency(settingsData.tenant?.currency || "CAD");
        setBusinessType(settingsData.tenant?.businessType || "restaurant");
      }
    } catch (error) {
      toast.error("Failed to load products");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleAvailable = async (product: Product) => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/products/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAvailable: !product.isAvailable }),
      });

      if ((await res.json()).success) {
        toast.success(product.isAvailable ? "Marked as sold out" : "Now available");
        loadData();
      }
    } catch (error) {
      toast.error("Failed to update product");
    }
  };

  const handleDelete = async (product: Product) => {
    if (!confirm(`Delete "${product.name}"?`)) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/products/${product.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (data.success) {
        toast.success(data.softDeleted ? "Product deactivated" : "Product deleted");
        loadData();
      } else {
        toast.error(data.error || "Failed to delete product");
      }
    } catch (error) {
      toast.error("Failed to delete product");
    }
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  // Filter products
  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      !searchQuery ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.sku?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !selectedCategory || product.category?.id === selectedCategory;
    return matchesSearch && matchesCategory;
  });

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
        title={businessType === "salon" ? "Services" : "Products"}
        subtitle={`${products.length} ${businessType === "salon" ? "services" : "products"} in your ${businessType === "salon" ? "catalog" : "menu"}`}
        actions={
          <>
            {businessType !== "salon" && (
              <Link href="/dashboard/admin/menu/bulk-upload">
                <Button icon="solar:upload-bold" variant="secondary">
                  Bulk Upload
                </Button>
              </Link>
            )}
            <Link href="/dashboard/admin/menu/products/new">
              <Button icon="solar:add-circle-bold">{businessType === "salon" ? "Add Service" : "Add Product"}</Button>
            </Link>
          </>
        }
      />

      <div className="p-6">
        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="flex-1">
            <Input
              placeholder="Search products..."
              icon="solar:magnifer-linear"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select
            options={[
              { value: "", label: "All Categories" },
              ...categories.map((c) => ({ value: c.id, label: c.name })),
            ]}
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full sm:w-48"
          />
        </div>

        {/* Products Table */}
        {loading ? (
          <Card padding="none">
            <div className="animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 border-b border-gray-100">
                  <div className="w-16 h-16 bg-gray-200 rounded-xl" />
                  <div className="flex-1">
                    <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
                    <div className="h-4 bg-gray-200 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : filteredProducts.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:box-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No products found</h3>
            <p className="text-gray-500 mb-4">
              {searchQuery || selectedCategory
                ? "Try adjusting your filters"
                : "Add your first product to get started"}
            </p>
            {!searchQuery && !selectedCategory && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/dashboard/admin/menu/products/new">
                  <Button icon="solar:add-circle-bold">Add Product</Button>
                </Link>
                {businessType !== "salon" && (
                  <Link href="/dashboard/admin/menu/bulk-upload">
                    <Button icon="solar:upload-bold" variant="secondary">
                      Or bulk upload via CSV
                    </Button>
                  </Link>
                )}
              </div>
            )}
          </Card>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{businessType === "salon" ? "Service" : "Product"}</th>
                    <th>{businessType === "salon" ? "Type" : "Category"}</th>
                    <th>Price</th>
                    {businessType === "salon" && <th>Duration</th>}
                    <th>Cost</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((product) => (
                    <tr key={product.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-gray-100 overflow-hidden flex-shrink-0">
                            {product.imageUrl ? (
                              <img
                                src={product.imageUrl}
                                alt={product.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Icon icon="solar:box-bold" className="w-6 h-6 text-gray-300" />
                              </div>
                            )}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{product.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              {product.sku && (
                                <span className="text-xs text-gray-400">SKU: {product.sku}</span>
                              )}
                              {product.variants && product.variants.length > 0 && (
                                <Badge size="sm" variant="info">
                                  {product.variants.length} variants
                                </Badge>
                              )}
                              {product.productAllergens && product.productAllergens.length > 0 && (
                                <span className="text-amber-500">
                                  {product.productAllergens.map((a) => a.allergen.icon).join("")}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        {product.category ? (
                          <Badge variant="gray">{product.category.name}</Badge>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="font-medium">{formatPrice(product.basePrice)}</td>
                      {businessType === "salon" && (
                        <td>
                          {(() => {
                            const dur =
                              product.prepTimeMinutes ?? product.durationMinutes;
                            return dur ? (
                              <span className="text-sm text-gray-600">{dur} min</span>
                            ) : (
                              <span className="text-gray-400">-</span>
                            );
                          })()}
                        </td>
                      )}
                      <td className="text-gray-500">{formatPrice(product.costPrice)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          {!product.isActive ? (
                            <Badge variant="danger">Inactive</Badge>
                          ) : !product.isAvailable ? (
                            <Badge variant="warning">Sold Out</Badge>
                          ) : (
                            <Badge variant="success" dot>
                              Available
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleToggleAvailable(product)}
                            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                            title={product.isAvailable ? "Mark sold out" : "Mark available"}
                          >
                            <Icon
                              icon={
                                product.isAvailable
                                  ? "solar:minus-circle-linear"
                                  : "solar:check-circle-linear"
                              }
                              className="w-5 h-5"
                            />
                          </button>
                          <Link href={`/dashboard/admin/menu/products/${product.id}`}>
                            <button className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                              <Icon icon="solar:pen-linear" className="w-5 h-5" />
                            </button>
                          </Link>
                          <button
                            onClick={() => handleDelete(product)}
                            className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                          >
                            <Icon icon="solar:trash-bin-trash-linear" className="w-5 h-5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
