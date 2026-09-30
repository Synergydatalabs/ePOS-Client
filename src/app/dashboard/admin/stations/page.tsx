"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Card, Badge, Modal, Toggle, Select } from "@/components/ui";

interface Station {
  id: string;
  name: string;
  description?: string;
  displayOrder: number;
  isActive: boolean;
  color?: string;
  _count?: { products: number; queueItems: number };
}

interface Location {
  id: string;
  name: string;
}

const STATION_COLORS = [
  { value: "#14b8a6", label: "Teal", class: "bg-teal-500" },
  { value: "#3b82f6", label: "Blue", class: "bg-blue-500" },
  { value: "#8b5cf6", label: "Purple", class: "bg-purple-500" },
  { value: "#ec4899", label: "Pink", class: "bg-pink-500" },
  { value: "#f97316", label: "Orange", class: "bg-orange-500" },
  { value: "#eab308", label: "Yellow", class: "bg-yellow-500" },
  { value: "#22c55e", label: "Green", class: "bg-green-500" },
  { value: "#ef4444", label: "Red", class: "bg-red-500" },
];

export default function StationsPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Station | null>(null);

  // Product assignment modal
  const [showProductsModal, setShowProductsModal] = useState(false);
  const [assigningStation, setAssigningStation] = useState<Station | null>(null);
  const [allProducts, setAllProducts] = useState<Array<{ id: string; name: string; categoryName?: string }>>([]);
  const [assignedProductIds, setAssignedProductIds] = useState<Set<string>>(new Set());
  const [productSearch, setProductSearch] = useState("");
  const [savingProducts, setSavingProducts] = useState(false);

  // Form data
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    color: "#14b8a6",
    isActive: true,
  });

  useEffect(() => {
    const storedTenant = localStorage.getItem("tap_active_tenant");
    const storedLocation = localStorage.getItem("tap_active_location");
    if (storedTenant) setTenantId(storedTenant);
    if (storedLocation) setLocationId(storedLocation);
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;

    try {
      // Load locations
      const locationsRes = await fetch(`/api/tenants/${tenantId}/locations`);
      const locationsData = await locationsRes.json();
      if (locationsData.success) {
        setLocations(locationsData.locations);
        if (!locationId && locationsData.locations.length > 0) {
          setLocationId(locationsData.locations[0].id);
          localStorage.setItem("tap_active_location", locationsData.locations[0].id);
        }
      }

      // Load stations if location selected
      if (locationId) {
        const stationsRes = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/stations`);
        const stationsData = await stationsRes.json();
        if (stationsData.success) setStations(stationsData.stations);
      }
    } catch (error) {
      toast.error("Failed to load stations");
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openModal = (station?: Station) => {
    if (station) {
      setEditing(station);
      setFormData({
        name: station.name,
        description: station.description || "",
        color: station.color || "#14b8a6",
        isActive: station.isActive,
      });
    } else {
      setEditing(null);
      setFormData({
        name: "",
        description: "",
        color: "#14b8a6",
        isActive: true,
      });
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Station name is required");
      return;
    }

    try {
      const payload = {
        name: formData.name,
        description: formData.description || undefined,
        color: formData.color,
        isActive: formData.isActive,
        displayOrder: editing ? editing.displayOrder : stations.length,
      };

      const url = editing
        ? `/api/tenants/${tenantId}/locations/${locationId}/stations/${editing.id}`
        : `/api/tenants/${tenantId}/locations/${locationId}/stations`;

      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(editing ? "Station updated" : "Station created");
        setShowModal(false);
        loadData();
      } else {
        toast.error(data.error || "Failed to save station");
      }
    } catch (error) {
      toast.error("Failed to save station");
    }
  };

  const openProductsModal = async (station: Station) => {
    if (!tenantId || !locationId) return;
    setAssigningStation(station);
    setProductSearch("");
    setShowProductsModal(true);

    try {
      // Load all tenant products
      const productsRes = await fetch(`/api/tenants/${tenantId}/products`);
      const productsData = await productsRes.json();
      if (productsData.success) {
        setAllProducts(
          productsData.products.map((p: any) => ({
            id: p.id,
            name: p.name,
            categoryName: p.category?.name,
          }))
        );
      }

      // Load currently assigned products for this station
      const stationRes = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/stations/${station.id}`);
      const stationData = await stationRes.json();
      if (stationData.success) {
        const assigned = new Set<string>(
          (stationData.station.stationProducts || []).map((sp: any) => sp.product.id)
        );
        setAssignedProductIds(assigned);
      }
    } catch (error) {
      toast.error("Failed to load products");
    }
  };

  const toggleProduct = (productId: string) => {
    setAssignedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const saveProductAssignments = async () => {
    if (!tenantId || !locationId || !assigningStation) return;
    setSavingProducts(true);
    try {
      const res = await fetch(
        `/api/tenants/${tenantId}/locations/${locationId}/stations/${assigningStation.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds: Array.from(assignedProductIds) }),
        }
      );
      const data = await res.json();
      if (data.success) {
        toast.success(`${assignedProductIds.size} product${assignedProductIds.size !== 1 ? "s" : ""} assigned to ${assigningStation.name}`);
        setShowProductsModal(false);
        loadData();
      } else {
        toast.error(data.error || "Failed to save");
      }
    } catch {
      toast.error("Failed to save");
    } finally {
      setSavingProducts(false);
    }
  };

  const filteredProducts = allProducts.filter((p) =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  const handleDelete = async (station: Station) => {
    if (station._count?.queueItems && station._count.queueItems > 0) {
      toast.error("Cannot delete station with active queue items");
      return;
    }
    if (!confirm(`Delete "${station.name}"?`)) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/stations/${station.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Station deleted");
        loadData();
      } else {
        toast.error(data.error || "Failed to delete station");
      }
    } catch (error) {
      toast.error("Failed to delete station");
    }
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
        title="Kitchen Stations"
        subtitle="Configure stations for your kitchen display"
        actions={
          locationId && (
            <Button icon="solar:add-circle-bold" onClick={() => openModal()}>
              Add Station
            </Button>
          )
        }
      />

      <div className="p-6">
        {/* Location Selector */}
        {locations.length > 1 && (
          <div className="mb-6">
            <Select
              label="Location"
              options={locations.map((l) => ({ value: l.id, label: l.name }))}
              value={locationId || ""}
              onChange={(e) => {
                setLocationId(e.target.value);
                localStorage.setItem("tap_active_location", e.target.value);
              }}
              className="max-w-xs"
            />
          </div>
        )}

        {!locationId ? (
          <Card className="text-center py-12">
            <Icon icon="solar:map-point-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No location selected</h3>
            <p className="text-gray-500">Please select or create a location first</p>
          </Card>
        ) : loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i}>
                <div className="animate-pulse">
                  <div className="w-12 h-12 bg-gray-200 rounded-xl mb-3" />
                  <div className="h-6 bg-gray-200 rounded w-1/2 mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-3/4" />
                </div>
              </Card>
            ))}
          </div>
        ) : stations.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:chef-hat-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No stations configured</h3>
            <p className="text-gray-500 mb-4">
              Create stations to organize your kitchen workflow (e.g., Grill, Fryer, Salads)
            </p>
            <Button icon="solar:add-circle-bold" onClick={() => openModal()}>
              Create First Station
            </Button>
          </Card>
        ) : (
          <>
            <div className="mb-6 p-4 bg-indigo-50 rounded-xl text-indigo-800 text-sm">
              <Icon icon="solar:info-circle-linear" className="w-5 h-5 inline mr-2" />
              Stations organize your kitchen display. Assign products to stations so orders route to the correct kitchen screen.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stations
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((station) => (
                  <Card key={station.id} className="relative">
                    <div className="flex items-start gap-4">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center"
                        style={{ backgroundColor: station.color || "#14b8a6" }}
                      >
                        <Icon icon="solar:chef-hat-bold" className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-gray-900">{station.name}</h3>
                          {!station.isActive && (
                            <Badge variant="danger" size="sm">Inactive</Badge>
                          )}
                        </div>
                        {station.description && (
                          <p className="text-sm text-gray-500 mt-1">{station.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-sm text-gray-400">
                          <span className="flex items-center gap-1">
                            <Icon icon="solar:box-bold" className="w-4 h-4" />
                            {station._count?.products || 0} products
                          </span>
                          {station._count?.queueItems !== undefined && station._count.queueItems > 0 && (
                            <span className="flex items-center gap-1 text-amber-600">
                              <Icon icon="solar:clock-circle-bold" className="w-4 h-4" />
                              {station._count.queueItems} in queue
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gray-100">
                      <button
                        onClick={() => openProductsModal(station)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-sm font-medium hover:bg-indigo-100 transition-colors"
                      >
                        <Icon icon="solar:box-bold" className="w-4 h-4" />
                        Manage Products
                      </button>
                      <button
                        onClick={() => openModal(station)}
                        className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                        title="Edit station"
                      >
                        <Icon icon="solar:pen-linear" className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => handleDelete(station)}
                        className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                        title="Delete station"
                      >
                        <Icon icon="solar:trash-bin-trash-linear" className="w-5 h-5" />
                      </button>
                    </div>
                  </Card>
                ))}
            </div>
          </>
        )}
      </div>

      {/* Station Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? "Edit Station" : "New Station"}
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="Station Name"
            placeholder="e.g., Grill, Fryer, Salads"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />

          <Input
            label="Description"
            placeholder="Optional description..."
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            multiline
            rows={2}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Station Color
            </label>
            <div className="flex flex-wrap gap-2">
              {STATION_COLORS.map((color) => (
                <button
                  key={color.value}
                  onClick={() => setFormData({ ...formData, color: color.value })}
                  className={`w-10 h-10 rounded-xl transition-all ${color.class} ${
                    formData.color === color.value
                      ? "ring-2 ring-offset-2 ring-gray-900 scale-110"
                      : "hover:scale-105"
                  }`}
                  title={color.label}
                />
              ))}
            </div>
          </div>

          <Toggle
            label="Active"
            description="Station receives orders"
            checked={formData.isActive}
            onChange={(checked) => setFormData({ ...formData, isActive: checked })}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editing ? "Save Changes" : "Create Station"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Product Assignment Modal */}
      <Modal
        isOpen={showProductsModal}
        onClose={() => setShowProductsModal(false)}
        title={assigningStation ? `Products for ${assigningStation.name}` : "Manage Products"}
        size="md"
      >
        <div className="space-y-4">
          <div className="p-3 bg-indigo-50 rounded-xl text-sm text-indigo-800">
            <Icon icon="solar:info-circle-bold" className="w-4 h-4 inline mr-1.5" />
            Select which products are prepared at this station. When a customer orders these items, the tickets will appear on this station's kitchen display.
          </div>

          <Input
            placeholder="Search products..."
            icon="solar:magnifer-linear"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
          />

          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">
              <strong>{assignedProductIds.size}</strong> of {allProducts.length} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setAssignedProductIds(new Set(filteredProducts.map((p) => p.id)))}
                className="text-indigo-600 font-medium hover:text-indigo-700"
              >
                Select all
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => setAssignedProductIds(new Set())}
                className="text-gray-500 font-medium hover:text-gray-700"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-100">
            {filteredProducts.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <Icon icon="solar:box-linear" className="w-10 h-10 mx-auto mb-2" />
                <p className="text-sm">No products found</p>
              </div>
            ) : (
              filteredProducts.map((product) => {
                const isAssigned = assignedProductIds.has(product.id);
                return (
                  <label
                    key={product.id}
                    className={`flex items-center gap-3 p-3 cursor-pointer transition-colors ${
                      isAssigned ? "bg-indigo-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isAssigned}
                      onChange={() => toggleProduct(product.id)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium truncate ${isAssigned ? "text-indigo-900" : "text-gray-900"}`}>
                        {product.name}
                      </p>
                      {product.categoryName && (
                        <p className="text-xs text-gray-500">{product.categoryName}</p>
                      )}
                    </div>
                    {isAssigned && (
                      <Icon icon="solar:check-circle-bold" className="w-5 h-5 text-indigo-600" />
                    )}
                  </label>
                );
              })
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="secondary" onClick={() => setShowProductsModal(false)}>
              Cancel
            </Button>
            <Button onClick={saveProductAssignments} disabled={savingProducts}>
              {savingProducts ? "Saving..." : `Save (${assignedProductIds.size})`}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
