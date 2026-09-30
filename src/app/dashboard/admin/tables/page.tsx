"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Card, Badge, Modal, Select } from "@/components/ui";

interface Table {
  id: string;
  tableNumber: number;
  name?: string;
  capacity: number;
  status: "AVAILABLE" | "OCCUPIED" | "RESERVED" | "MAINTENANCE" | "CLEANING" | "BLOCKED";
  currentOrderId?: string;
  qrCode?: string;
  qrCodeUrl?: string;
  currentSession?: {
    id: string;
    guestCount: number;
    status: string;
  };
}

interface Location {
  id: string;
  name: string;
}

export default function TablesPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [editing, setEditing] = useState<Table | null>(null);
  const [selectedTableForQR, setSelectedTableForQR] = useState<Table | null>(null);

  // Form data
  const [formData, setFormData] = useState({
    tableNumber: "",
    name: "",
    capacity: "4",
    status: "AVAILABLE" as Table["status"],
  });

  const [bulkForm, setBulkForm] = useState({
    count: "10",
    startNumber: "1",
    capacity: "4",
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
        // Use first location if none selected
        if (!locationId && locationsData.locations.length > 0) {
          setLocationId(locationsData.locations[0].id);
          localStorage.setItem("tap_active_location", locationsData.locations[0].id);
        }
      }

      // Load tables if location selected
      if (locationId) {
        const tablesRes = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/tables`);
        const tablesData = await tablesRes.json();
        if (tablesData.success) setTables(tablesData.tables);
      }
    } catch (error) {
      toast.error("Failed to load tables");
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const getStatusColor = (status: Table["status"]) => {
    switch (status) {
      case "AVAILABLE":
        return "success";
      case "OCCUPIED":
        return "danger";
      case "RESERVED":
        return "warning";
      case "MAINTENANCE":
        return "gray";
      default:
        return "gray";
    }
  };

  const getStatusIcon = (status: Table["status"]) => {
    switch (status) {
      case "AVAILABLE":
        return "solar:check-circle-bold";
      case "OCCUPIED":
        return "solar:users-group-rounded-bold";
      case "RESERVED":
        return "solar:calendar-bold";
      case "MAINTENANCE":
        return "solar:tools-bold";
      default:
        return "solar:question-circle-bold";
    }
  };

  const openModal = (table?: Table) => {
    if (table) {
      setEditing(table);
      setFormData({
        tableNumber: table.tableNumber.toString(),
        name: table.name || "",
        capacity: table.capacity.toString(),
        status: table.status,
      });
    } else {
      setEditing(null);
      const nextNumber = tables.length > 0 ? Math.max(...tables.map((t) => t.tableNumber)) + 1 : 1;
      setFormData({
        tableNumber: nextNumber.toString(),
        name: "",
        capacity: "4",
        status: "AVAILABLE",
      });
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.tableNumber) {
      toast.error("Table number is required");
      return;
    }

    try {
      const payload = {
        tableNumber: parseInt(formData.tableNumber),
        name: formData.name || undefined,
        capacity: parseInt(formData.capacity) || 4,
        status: formData.status,
      };

      const url = editing
        ? `/api/tenants/${tenantId}/locations/${locationId}/tables/${editing.id}`
        : `/api/tenants/${tenantId}/locations/${locationId}/tables`;

      const res = await fetch(url, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(editing ? "Table updated" : "Table created");
        setShowModal(false);
        loadData();
      } else {
        toast.error(data.error || "Failed to save table");
      }
    } catch (error) {
      toast.error("Failed to save table");
    }
  };

  const handleBulkCreate = async () => {
    const count = parseInt(bulkForm.count);
    const startNumber = parseInt(bulkForm.startNumber);
    const capacity = parseInt(bulkForm.capacity);

    if (!count || count <= 0 || count > 100) {
      toast.error("Enter a valid count (1-100)");
      return;
    }

    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/tables/bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          count,
          startNumber,
          capacity,
        }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(`Created ${data.created} tables`);
        setShowBulkModal(false);
        loadData();
      } else {
        toast.error(data.error || "Failed to create tables");
      }
    } catch (error) {
      toast.error("Failed to create tables");
    }
  };

  const handleDelete = async (table: Table) => {
    if (table.status === "OCCUPIED") {
      toast.error("Cannot delete occupied table");
      return;
    }
    if (!confirm(`Delete Table ${table.tableNumber}?`)) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/tables/${table.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Table deleted");
        loadData();
      } else {
        toast.error(data.error || "Failed to delete table");
      }
    } catch (error) {
      toast.error("Failed to delete table");
    }
  };

  const handleStatusChange = async (table: Table, newStatus: Table["status"]) => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/tables/${table.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(`Table ${table.tableNumber} is now ${newStatus.toLowerCase()}`);
        loadData();
      } else {
        toast.error(data.error || "Failed to update status");
      }
    } catch (error) {
      toast.error("Failed to update status");
    }
  };

  const showQRCode = (table: Table) => {
    setSelectedTableForQR(table);
    setShowQRModal(true);
  };

  const regenerateQR = async (table: Table) => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/tables/${table.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "regenerate_qr" }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("QR code regenerated");
        setSelectedTableForQR(data.table);
        loadData();
      } else {
        toast.error(data.error || "Failed to regenerate QR");
      }
    } catch (error) {
      toast.error("Failed to regenerate QR");
    }
  };

  const downloadQR = (table: Table) => {
    if (!table.qrCodeUrl) {
      toast.error("No QR code available");
      return;
    }
    const link = document.createElement("a");
    link.href = table.qrCodeUrl;
    link.download = `table-${table.tableNumber}-qr.png`;
    link.click();
  };

  const printQR = (table: Table) => {
    if (!table.qrCodeUrl) {
      toast.error("No QR code available");
      return;
    }
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>Table ${table.tableNumber} QR Code</title>
            <style>
              body {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                font-family: Arial, sans-serif;
              }
              img { width: 300px; height: 300px; }
              h1 { margin-bottom: 10px; }
              p { color: #666; margin-top: 10px; }
            </style>
          </head>
          <body>
            <h1>Table ${table.tableNumber}</h1>
            <img src="${table.qrCodeUrl}" alt="QR Code" />
            <p>Scan to order</p>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.print();
    }
  };

  // Stats
  const stats = {
    total: tables.length,
    available: tables.filter((t) => t.status === "AVAILABLE").length,
    occupied: tables.filter((t) => t.status === "OCCUPIED").length,
    reserved: tables.filter((t) => t.status === "RESERVED").length,
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
        title="Tables"
        subtitle={locationId ? `Managing tables at selected location` : "Select a location"}
        actions={
          locationId && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                icon="solar:copy-bold"
                onClick={() => {
                  const nextNumber = tables.length > 0 ? Math.max(...tables.map((t) => t.tableNumber)) + 1 : 1;
                  setBulkForm({
                    count: "10",
                    startNumber: nextNumber.toString(),
                    capacity: "4",
                  });
                  setShowBulkModal(true);
                }}
              >
                Bulk Create
              </Button>
              <Button icon="solar:add-circle-bold" onClick={() => openModal()}>
                Add Table
              </Button>
            </div>
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
        ) : (
          <>
            {/* Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-gray-900">{stats.total}</p>
                  <p className="text-sm text-gray-500">Total Tables</p>
                </div>
              </Card>
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-green-600">{stats.available}</p>
                  <p className="text-sm text-gray-500">Available</p>
                </div>
              </Card>
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-red-600">{stats.occupied}</p>
                  <p className="text-sm text-gray-500">Occupied</p>
                </div>
              </Card>
              <Card>
                <div className="text-center">
                  <p className="text-3xl font-bold text-amber-600">{stats.reserved}</p>
                  <p className="text-sm text-gray-500">Reserved</p>
                </div>
              </Card>
            </div>

            {/* Tables Grid */}
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Card key={i}>
                    <div className="animate-pulse text-center">
                      <div className="w-16 h-16 bg-gray-200 rounded-2xl mx-auto mb-3" />
                      <div className="h-5 bg-gray-200 rounded w-1/2 mx-auto" />
                    </div>
                  </Card>
                ))}
              </div>
            ) : tables.length === 0 ? (
              <Card className="text-center py-12">
                <Icon icon="solar:sofa-2-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No tables yet</h3>
                <p className="text-gray-500 mb-4">Add tables for dine-in orders</p>
                <div className="flex items-center justify-center gap-3">
                  <Button
                    variant="secondary"
                    icon="solar:copy-bold"
                    onClick={() => setShowBulkModal(true)}
                  >
                    Bulk Create
                  </Button>
                  <Button icon="solar:add-circle-bold" onClick={() => openModal()}>
                    Add Table
                  </Button>
                </div>
              </Card>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                {tables
                  .sort((a, b) => a.tableNumber - b.tableNumber)
                  .map((table) => (
                    <Card
                      key={table.id}
                      className={`relative cursor-pointer transition-all hover:shadow-lg ${
                        table.status === "OCCUPIED" ? "ring-2 ring-red-200" : ""
                      }`}
                    >
                      {/* QR Button */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          showQRCode(table);
                        }}
                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-gray-100 hover:bg-primary-100 text-gray-500 hover:text-primary-600 transition-colors"
                        title="View QR Code"
                      >
                        <Icon icon="solar:qr-code-bold" className="w-4 h-4" />
                      </button>

                      <div className="text-center" onClick={() => openModal(table)}>
                        <div
                          className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-3 ${
                            table.status === "AVAILABLE"
                              ? "bg-green-100"
                              : table.status === "OCCUPIED"
                              ? "bg-red-100"
                              : table.status === "RESERVED"
                              ? "bg-amber-100"
                              : "bg-gray-100"
                          }`}
                        >
                          <Icon
                            icon={getStatusIcon(table.status)}
                            className={`w-8 h-8 ${
                              table.status === "AVAILABLE"
                                ? "text-green-600"
                                : table.status === "OCCUPIED"
                                ? "text-red-600"
                                : table.status === "RESERVED"
                                ? "text-amber-600"
                                : "text-gray-600"
                            }`}
                          />
                        </div>
                        <h3 className="font-bold text-gray-900 text-lg">
                          {table.name || `Table ${table.tableNumber}`}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {table.capacity} seats
                        </p>
                        <Badge
                          variant={getStatusColor(table.status)}
                          size="sm"
                          className="mt-2"
                        >
                          {table.status.charAt(0) + table.status.slice(1).toLowerCase()}
                        </Badge>
                        {table.currentSession && (
                          <p className="text-xs text-primary-600 mt-1">
                            {table.currentSession.guestCount} guests
                          </p>
                        )}
                      </div>
                    </Card>
                  ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Table Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? `Edit Table ${editing.tableNumber}` : "New Table"}
        size="sm"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Table Number"
              type="number"
              min={1}
              value={formData.tableNumber}
              onChange={(e) => setFormData({ ...formData, tableNumber: e.target.value })}
              required
            />
            <Input
              label="Capacity"
              type="number"
              min={1}
              value={formData.capacity}
              onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
            />
          </div>

          <Input
            label="Custom Name"
            placeholder="e.g., Window Booth, Patio 1"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />

          <Select
            label="Status"
            options={[
              { value: "AVAILABLE", label: "Available" },
              { value: "OCCUPIED", label: "Occupied" },
              { value: "RESERVED", label: "Reserved" },
              { value: "MAINTENANCE", label: "Maintenance" },
            ]}
            value={formData.status}
            onChange={(e) => setFormData({ ...formData, status: e.target.value as Table["status"] })}
          />

          {editing && (
            <div className="flex flex-wrap gap-2 pt-2">
              <p className="w-full text-sm text-gray-500 mb-1">Quick Status:</p>
              {(["AVAILABLE", "OCCUPIED", "RESERVED", "MAINTENANCE"] as Table["status"][])
                .filter((s) => s !== editing.status)
                .map((status) => (
                  <button
                    key={status}
                    onClick={() => {
                      handleStatusChange(editing, status);
                      setShowModal(false);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      status === "AVAILABLE"
                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                        : status === "OCCUPIED"
                        ? "bg-red-100 text-red-700 hover:bg-red-200"
                        : status === "RESERVED"
                        ? "bg-amber-100 text-amber-700 hover:bg-amber-200"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {status.charAt(0) + status.slice(1).toLowerCase()}
                  </button>
                ))}
            </div>
          )}

          <div className="flex justify-between gap-3 pt-4">
            {editing && (
              <Button
                variant="danger"
                onClick={() => {
                  handleDelete(editing);
                  setShowModal(false);
                }}
              >
                Delete
              </Button>
            )}
            <div className="flex gap-3 ml-auto">
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>
                {editing ? "Save Changes" : "Create Table"}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Bulk Create Modal */}
      <Modal
        isOpen={showBulkModal}
        onClose={() => setShowBulkModal(false)}
        title="Bulk Create Tables"
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="Number of Tables"
            type="number"
            min={1}
            max={100}
            value={bulkForm.count}
            onChange={(e) => setBulkForm({ ...bulkForm, count: e.target.value })}
            helperText="Max 100 at a time"
          />

          <Input
            label="Starting Number"
            type="number"
            min={1}
            value={bulkForm.startNumber}
            onChange={(e) => setBulkForm({ ...bulkForm, startNumber: e.target.value })}
            helperText={`Will create tables ${bulkForm.startNumber} to ${
              parseInt(bulkForm.startNumber) + parseInt(bulkForm.count) - 1
            }`}
          />

          <Input
            label="Default Capacity"
            type="number"
            min={1}
            value={bulkForm.capacity}
            onChange={(e) => setBulkForm({ ...bulkForm, capacity: e.target.value })}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowBulkModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkCreate}>
              Create {bulkForm.count} Tables
            </Button>
          </div>
        </div>
      </Modal>

      {/* QR Code Modal */}
      <Modal
        isOpen={showQRModal}
        onClose={() => setShowQRModal(false)}
        title={`QR Code - Table ${selectedTableForQR?.tableNumber}`}
        size="sm"
      >
        {selectedTableForQR && (
          <div className="text-center space-y-4">
            {selectedTableForQR.qrCodeUrl ? (
              <>
                <div className="bg-white p-4 rounded-xl border-2 border-dashed border-gray-200 inline-block">
                  <img
                    src={selectedTableForQR.qrCodeUrl}
                    alt={`QR Code for Table ${selectedTableForQR.tableNumber}`}
                    className="w-64 h-64 mx-auto"
                  />
                </div>
                <p className="text-sm text-gray-500">
                  Scan this QR code to order from Table {selectedTableForQR.tableNumber}
                </p>
                <div className="text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded-lg">
                  {typeof window !== "undefined" && window.location.origin}/table/{selectedTableForQR.qrCode}
                </div>
                <div className="flex justify-center gap-3 pt-2">
                  <Button
                    variant="secondary"
                    icon="solar:download-bold"
                    onClick={() => downloadQR(selectedTableForQR)}
                  >
                    Download
                  </Button>
                  <Button
                    variant="secondary"
                    icon="solar:printer-bold"
                    onClick={() => printQR(selectedTableForQR)}
                  >
                    Print
                  </Button>
                  <Button
                    variant="secondary"
                    icon="solar:refresh-bold"
                    onClick={() => regenerateQR(selectedTableForQR)}
                  >
                    Regenerate
                  </Button>
                </div>
              </>
            ) : (
              <div className="py-8">
                <Icon
                  icon="solar:qr-code-linear"
                  className="w-16 h-16 text-gray-300 mx-auto mb-4"
                />
                <p className="text-gray-500 mb-4">No QR code generated for this table</p>
                <Button onClick={() => regenerateQR(selectedTableForQR)}>
                  Generate QR Code
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
