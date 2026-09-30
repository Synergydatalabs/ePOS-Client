"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Card, Modal, Input, Select } from "@/components/ui";

interface Allergen {
  id: string;
  code: string;
  name: string;
  icon: string;
  severity: string;
  isGlobal: boolean;
}

const SEVERITY_OPTIONS = [
  { value: "HIGH", label: "High - Life-threatening" },
  { value: "MEDIUM", label: "Medium - Significant reaction" },
  { value: "LOW", label: "Low - Mild sensitivity" },
];

const COMMON_ICONS = ["🥜", "🥛", "🥚", "🌾", "🫘", "🐟", "🦐", "🌰", "🌿", "🥬", "🐚", "⚗️", "⚠️"];

export default function AllergensPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [allergens, setAllergens] = useState<Allergen[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    code: "",
    name: "",
    icon: "⚠️",
    severity: "MEDIUM",
  });

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const loadAllergens = useCallback(async () => {
    if (!tenantId) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/allergens`);
      const data = await res.json();

      if (data.success) {
        setAllergens(data.allergens);
      }
    } catch (error) {
      toast.error("Failed to load allergens");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadAllergens();
  }, [loadAllergens]);

  const openModal = () => {
    setForm({
      code: "",
      name: "",
      icon: "⚠️",
      severity: "MEDIUM",
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      toast.error("Code and name are required");
      return;
    }

    setSaving(true);

    try {
      const res = await fetch(`/api/tenants/${tenantId}/allergens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Allergen created");
        setShowModal(false);
        loadAllergens();
      } else {
        toast.error(data.error || "Failed to create allergen");
      }
    } catch (error) {
      toast.error("Failed to create allergen");
    } finally {
      setSaving(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "HIGH":
        return "bg-red-100 text-red-700";
      case "MEDIUM":
        return "bg-amber-100 text-amber-700";
      case "LOW":
        return "bg-green-100 text-green-700";
      default:
        return "bg-gray-100 text-gray-700";
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
        title="Allergens"
        subtitle="Manage food allergens for your menu items"
        actions={
          <Button icon="solar:add-circle-bold" onClick={openModal}>
            Add Allergen
          </Button>
        }
      />

      <div className="p-6">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i}>
                <div className="animate-pulse">
                  <div className="w-12 h-12 bg-gray-200 rounded-xl mx-auto mb-3" />
                  <div className="h-4 bg-gray-200 rounded w-2/3 mx-auto mb-2" />
                  <div className="h-3 bg-gray-200 rounded w-1/2 mx-auto" />
                </div>
              </Card>
            ))}
          </div>
        ) : allergens.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:danger-triangle-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No allergens configured</h3>
            <p className="text-gray-500 mb-4">Add common food allergens to track in your menu</p>
            <Button icon="solar:add-circle-bold" onClick={openModal}>
              Add First Allergen
            </Button>
          </Card>
        ) : (
          <>
            <div className="mb-6 p-4 bg-indigo-50 rounded-xl text-indigo-800 text-sm">
              <Icon icon="solar:info-circle-linear" className="w-5 h-5 inline mr-2" />
              Allergens help inform customers about potential allergic reactions. Assign them to products in the product editor.
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {allergens.map((allergen) => (
                <Card key={allergen.id} className="text-center p-4">
                  <div className="text-4xl mb-3">{allergen.icon}</div>
                  <h3 className="font-semibold text-gray-900 mb-1">{allergen.name}</h3>
                  <p className="text-xs text-gray-500 mb-2">{allergen.code}</p>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getSeverityColor(allergen.severity)}`}>
                    {allergen.severity}
                  </span>
                  {allergen.isGlobal && (
                    <p className="text-xs text-gray-400 mt-2">Global</p>
                  )}
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Add Allergen Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Add Custom Allergen"
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="Code"
            placeholder="e.g., SESAME"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            hint="Unique identifier (uppercase)"
          />

          <Input
            label="Name"
            placeholder="e.g., Sesame Seeds"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Icon
            </label>
            <div className="flex flex-wrap gap-2">
              {COMMON_ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setForm({ ...form, icon })}
                  className={`w-10 h-10 text-xl rounded-lg border-2 transition-all ${
                    form.icon === icon
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>

          <Select
            label="Severity"
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
            options={SEVERITY_OPTIONS}
          />

          <div className="flex gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowModal(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving} className="flex-1">
              Create Allergen
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
