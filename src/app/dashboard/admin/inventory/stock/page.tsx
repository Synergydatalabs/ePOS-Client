"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Select, Card, Badge, Modal } from "@/components/ui";

interface Unit {
  id: string;
  name: string;
  symbol?: string;
}

interface Ingredient {
  id: string;
  name: string;
  unit?: Unit;
  lowStockThreshold: number;
}

// Matches the flat shape returned by /api/tenants/{id}/locations/{id}/inventory
interface InventoryItem {
  ingredientId: string;
  ingredientName: string;
  sku?: string;
  unit?: Unit;
  currentStock: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  costPerUnit: number;
  totalValue: number;
  lastCountedAt?: string;
}

interface Location {
  id: string;
  name: string;
}

export default function StockPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "out">("all");

  // Modal states
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);

  // Form data
  const [adjustForm, setAdjustForm] = useState({
    type: "ADJUSTMENT" as "PURCHASE" | "ADJUSTMENT" | "WASTE" | "RETURN",
    quantity: "",
    notes: "",
  });

  const [transferForm, setTransferForm] = useState({
    toLocationId: "",
    quantity: "",
    notes: "",
  });

  useEffect(() => {
    const storedTenant = localStorage.getItem("tap_active_tenant");
    const storedLocation = localStorage.getItem("tap_active_location");
    if (storedTenant) setTenantId(storedTenant);
    if (storedLocation) setLocationId(storedLocation);
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId || !locationId) return;

    try {
      const [inventoryRes, ingredientsRes, locationsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/locations/${locationId}/inventory`),
        fetch(`/api/tenants/${tenantId}/ingredients`),
        fetch(`/api/tenants/${tenantId}/locations`),
      ]);

      const [inventoryData, ingredientsData, locationsData] = await Promise.all([
        inventoryRes.json(),
        ingredientsRes.json(),
        locationsRes.json(),
      ]);

      if (inventoryData.success) setInventory(inventoryData.inventory);
      if (ingredientsData.success) setIngredients(ingredientsData.ingredients);
      if (locationsData.success) setLocations(locationsData.locations.filter((l: Location) => l.id !== locationId));
    } catch (error) {
      toast.error("Failed to load inventory");
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getStockStatus = (item: InventoryItem) => {
    const qty = Number(item.currentStock) || 0;
    const threshold = Number(item.lowStockThreshold) || 0;
    if (qty <= 0) return "out";
    if (threshold > 0 && qty <= threshold) return "low";
    return "ok";
  };

  const openAdjustModal = (item: InventoryItem) => {
    setSelectedItem(item);
    setAdjustForm({
      type: "ADJUSTMENT",
      quantity: "",
      notes: "",
    });
    setShowAdjustModal(true);
  };

  const openTransferModal = (item: InventoryItem) => {
    setSelectedItem(item);
    setTransferForm({
      toLocationId: "",
      quantity: "",
      notes: "",
    });
    setShowTransferModal(true);
  };

  const handleAdjust = async () => {
    if (!selectedItem || !adjustForm.quantity) {
      toast.error("Please enter a quantity");
      return;
    }

    const quantity = parseFloat(adjustForm.quantity);
    if (isNaN(quantity) || quantity === 0) {
      toast.error("Please enter a valid quantity");
      return;
    }

    try {
      // API expects positive-to-add, negative-to-remove; WASTE/RETURN = removal
      const signed =
        adjustForm.type === "WASTE" || adjustForm.type === "RETURN"
          ? -Math.abs(quantity)
          : quantity;

      const res = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId: selectedItem.ingredientId,
          type: adjustForm.type,
          quantity: signed,
          reason: adjustForm.notes || undefined,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Stock adjusted successfully");
        setShowAdjustModal(false);
        loadData();
      } else {
        toast.error(data.error || "Failed to adjust stock");
      }
    } catch (error) {
      toast.error("Failed to adjust stock");
    }
  };

  const handleTransfer = async () => {
    if (!selectedItem || !transferForm.toLocationId || !transferForm.quantity) {
      toast.error("Please fill in all fields");
      return;
    }

    const quantity = parseFloat(transferForm.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      toast.error("Please enter a valid quantity");
      return;
    }

    if (quantity > selectedItem.currentStock) {
      toast.error("Insufficient stock for transfer");
      return;
    }

    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/inventory/transfer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId: selectedItem.ingredientId,
          toLocationId: transferForm.toLocationId,
          quantity: quantity,
          notes: transferForm.notes || undefined,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Stock transferred successfully");
        setShowTransferModal(false);
        loadData();
      } else {
        toast.error(data.error || "Failed to transfer stock");
      }
    } catch (error) {
      toast.error("Failed to transfer stock");
    }
  };

  // Filter inventory
  const filteredInventory = inventory.filter((item) => {
    const matchesSearch =
      !searchQuery ||
      item.ingredientName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sku?.toLowerCase().includes(searchQuery.toLowerCase());

    const status = getStockStatus(item);
    const matchesFilter =
      filter === "all" ||
      (filter === "low" && status === "low") ||
      (filter === "out" && status === "out");

    return matchesSearch && matchesFilter;
  });

  // Stats
  const lowStockCount = inventory.filter((i) => getStockStatus(i) === "low").length;
  const outOfStockCount = inventory.filter((i) => getStockStatus(i) === "out").length;

  if (!tenantId || !locationId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Please select a location first</p>
      </div>
    );
  }

  return (
    <div>
      <AdminHeader
        title="Stock Levels"
        subtitle="Manage inventory at this location"
      />

      <div className="p-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <Card
            className={`cursor-pointer transition-all ${filter === "all" ? "ring-2 ring-teal-500" : ""}`}
            onClick={() => setFilter("all")}
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-teal-100 flex items-center justify-center">
                <Icon icon="solar:box-bold" className="w-6 h-6 text-teal-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{inventory.length}</p>
                <p className="text-sm text-gray-500">Total Items</p>
              </div>
            </div>
          </Card>

          <Card
            className={`cursor-pointer transition-all ${filter === "low" ? "ring-2 ring-amber-500" : ""}`}
            onClick={() => setFilter("low")}
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center">
                <Icon icon="solar:danger-triangle-bold" className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600">{lowStockCount}</p>
                <p className="text-sm text-gray-500">Low Stock</p>
              </div>
            </div>
          </Card>

          <Card
            className={`cursor-pointer transition-all ${filter === "out" ? "ring-2 ring-red-500" : ""}`}
            onClick={() => setFilter("out")}
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center">
                <Icon icon="solar:close-circle-bold" className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">{outOfStockCount}</p>
                <p className="text-sm text-gray-500">Out of Stock</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Search */}
        <div className="mb-6">
          <Input
            placeholder="Search inventory..."
            icon="solar:magnifer-linear"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md"
          />
        </div>

        {/* Inventory Table */}
        {loading ? (
          <Card padding="none">
            <div className="animate-pulse">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 p-4 border-b border-gray-100">
                  <div className="w-10 h-10 bg-gray-200 rounded-xl" />
                  <div className="flex-1">
                    <div className="h-5 bg-gray-200 rounded w-1/3 mb-2" />
                    <div className="h-4 bg-gray-200 rounded w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : filteredInventory.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:box-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No inventory found</h3>
            <p className="text-gray-500">
              {searchQuery || filter !== "all"
                ? "Try adjusting your filters"
                : "Add ingredients to start tracking stock"}
            </p>
          </Card>
        ) : (
          <Card padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Ingredient</th>
                    <th>Current Stock</th>
                    <th>Alert Level</th>
                    <th>Status</th>
                    <th>Last Restocked</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map((item) => {
                    const status = getStockStatus(item);
                    const unitLabel = item.unit?.symbol || item.unit?.name || "units";
                    return (
                      <tr key={item.ingredientId}>
                        <td>
                          <p className="font-medium text-gray-900">{item.ingredientName}</p>
                          {item.sku && <p className="text-xs text-gray-400">{item.sku}</p>}
                        </td>
                        <td>
                          <span className={`font-semibold ${
                            status === "out" ? "text-red-600" :
                            status === "low" ? "text-amber-600" :
                            "text-gray-900"
                          }`}>
                            {Number(item.currentStock || 0).toLocaleString()} {unitLabel}
                          </span>
                        </td>
                        <td className="text-gray-500">
                          {Number(item.lowStockThreshold || 0).toLocaleString()} {unitLabel}
                        </td>
                        <td>
                          {status === "out" ? (
                            <Badge variant="danger">Out of Stock</Badge>
                          ) : status === "low" ? (
                            <Badge variant="warning">Low Stock</Badge>
                          ) : (
                            <Badge variant="success" dot>In Stock</Badge>
                          )}
                        </td>
                        <td className="text-gray-500">
                          {item.lastCountedAt
                            ? new Date(item.lastCountedAt).toLocaleDateString()
                            : "-"}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => openAdjustModal(item)}
                              className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                              title="Adjust stock"
                            >
                              <Icon icon="solar:pen-linear" className="w-5 h-5" />
                            </button>
                            {locations.length > 0 && (
                              <button
                                onClick={() => openTransferModal(item)}
                                className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                                title="Transfer stock"
                              >
                                <Icon icon="solar:transfer-horizontal-linear" className="w-5 h-5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* Adjust Stock Modal */}
      <Modal
        isOpen={showAdjustModal}
        onClose={() => setShowAdjustModal(false)}
        title={`Adjust Stock: ${selectedItem?.ingredientName || ""}`}
        size="sm"
      >
        <div className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-xl">
            <p className="text-sm text-gray-500">Current Stock</p>
            <p className="text-xl font-bold text-gray-900">
              {Number(selectedItem?.currentStock || 0).toLocaleString()} {selectedItem?.unit?.symbol || selectedItem?.unit?.name || "units"}
            </p>
          </div>

          <Select
            label="Adjustment Type"
            options={[
              { value: "PURCHASE", label: "Purchase / Restock" },
              { value: "ADJUSTMENT", label: "Manual Adjustment" },
              { value: "WASTE", label: "Waste / Spoilage" },
              { value: "RETURN", label: "Return to Supplier" },
            ]}
            value={adjustForm.type}
            onChange={(e) => setAdjustForm({ ...adjustForm, type: e.target.value as any })}
          />

          <Input
            label="Quantity"
            type="number"
            step="0.01"
            placeholder={adjustForm.type === "PURCHASE" ? "Amount to add" : "Amount to add/remove"}
            value={adjustForm.quantity}
            onChange={(e) => setAdjustForm({ ...adjustForm, quantity: e.target.value })}
            helperText={
              adjustForm.type === "WASTE" || adjustForm.type === "RETURN"
                ? "Enter positive number (will be subtracted)"
                : "Positive to add, negative to subtract"
            }
          />

          <Input
            label="Notes"
            placeholder="Optional notes..."
            value={adjustForm.notes}
            onChange={(e) => setAdjustForm({ ...adjustForm, notes: e.target.value })}
            multiline
            rows={2}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowAdjustModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdjust}>
              Apply Adjustment
            </Button>
          </div>
        </div>
      </Modal>

      {/* Transfer Stock Modal */}
      <Modal
        isOpen={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        title={`Transfer: ${selectedItem?.ingredientName || ""}`}
        size="sm"
      >
        <div className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-xl">
            <p className="text-sm text-gray-500">Available Stock</p>
            <p className="text-xl font-bold text-gray-900">
              {Number(selectedItem?.currentStock || 0).toLocaleString()} {selectedItem?.unit?.symbol || selectedItem?.unit?.name || "units"}
            </p>
          </div>

          <Select
            label="Transfer To"
            options={[
              { value: "", label: "Select location" },
              ...locations.map((l) => ({ value: l.id, label: l.name })),
            ]}
            value={transferForm.toLocationId}
            onChange={(e) => setTransferForm({ ...transferForm, toLocationId: e.target.value })}
          />

          <Input
            label="Quantity to Transfer"
            type="number"
            step="0.01"
            min={0}
            max={selectedItem?.currentStock || 0}
            placeholder="0"
            value={transferForm.quantity}
            onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })}
          />

          <Input
            label="Notes"
            placeholder="Optional notes..."
            value={transferForm.notes}
            onChange={(e) => setTransferForm({ ...transferForm, notes: e.target.value })}
            multiline
            rows={2}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowTransferModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleTransfer}>
              Transfer Stock
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
