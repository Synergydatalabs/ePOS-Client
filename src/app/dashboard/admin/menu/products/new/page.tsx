"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Select, Card, Toggle, Badge } from "@/components/ui";

interface Category {
  id: string;
  name: string;
}

interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  modifiers: { id: string; name: string; price: number }[];
}

interface Allergen {
  id: string;
  name: string;
  icon: string;
}

interface Station {
  id: string;
  name: string;
}

interface Variant {
  id?: string;
  name: string;
  sku: string;
  price: number;
  costPrice: number;
  isAvailable: boolean;
}

export default function NewProductPage() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState("CAD");
  const [businessType, setBusinessType] = useState("restaurant");

  // Form data
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    sku: "",
    barcode: "",
    taxCategoryId: "",
    basePrice: "",
    costPrice: "",
    categoryId: "",
    stationId: "",
    imageUrl: "",
    isActive: true,
    isAvailable: true,
    prepTime: "10",
    taxable: true,
    trackInventory: false,
    durationMinutes: "",
    requiresTechnician: true,
  });

  // Related data
  const [categories, setCategories] = useState<Category[]>([]);
  // Tax categories — nullable list; empty means the tenant hasn't set any up yet
  const [taxCategories, setTaxCategories] = useState<Array<{ id: string; name: string; ratePercent: string; isDefault: boolean }>>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [allergens, setAllergens] = useState<Allergen[]>([]);
  const [stations, setStations] = useState<Station[]>([]);

  // Selected items
  const [selectedModifierGroups, setSelectedModifierGroups] = useState<string[]>([]);
  const [selectedAllergens, setSelectedAllergens] = useState<string[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);

  // Active tab
  const [activeTab, setActiveTab] = useState<"basic" | "pricing" | "modifiers" | "allergens" | "variants">("basic");

  useEffect(() => {
    const storedTenant = localStorage.getItem("tap_active_tenant");
    const storedLocation = localStorage.getItem("tap_active_location");
    if (storedTenant) setTenantId(storedTenant);
    if (storedLocation) setLocationId(storedLocation);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    loadData();
  }, [tenantId, locationId]);

  const loadData = async () => {
    try {
      const [categoriesRes, modifiersRes, allergensRes, settingsRes, taxRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/categories`),
        fetch(`/api/tenants/${tenantId}/modifier-groups`),
        fetch(`/api/tenants/${tenantId}/allergens`),
        fetch(`/api/tenants/${tenantId}/settings`),
        fetch(`/api/tenants/${tenantId}/tax-categories`),
      ]);

      const [categoriesData, modifiersData, allergensData, settingsData, taxData] = await Promise.all([
        categoriesRes.json(),
        modifiersRes.json(),
        allergensRes.json(),
        settingsRes.json(),
        taxRes.json(),
      ]);

      if (categoriesData.success) setCategories(categoriesData.categories);
      if (modifiersData.success) setModifierGroups(modifiersData.modifierGroups);
      if (allergensData.success) setAllergens(allergensData.allergens);
      if (taxData.success) setTaxCategories(taxData.categories || []);
      if (settingsData.success) {
        setCurrency(settingsData.tenant?.currency || "CAD");
        setBusinessType(settingsData.tenant?.businessType || "restaurant");
      }

      // Load stations if location selected
      if (locationId) {
        const stationsRes = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/stations`);
        const stationsData = await stationsRes.json();
        if (stationsData.success) setStations(stationsData.stations);
      }
    } catch (error) {
      toast.error("Failed to load data");
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const addVariant = () => {
    setVariants([
      ...variants,
      { name: "", sku: "", price: 0, costPrice: 0, isAvailable: true },
    ]);
  };

  const updateVariant = (index: number, field: string, value: any) => {
    setVariants((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removeVariant = (index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast.error("Product name is required");
      return;
    }

    if (!formData.basePrice) {
      toast.error("Base price is required");
      return;
    }

    setSaving(true);

    try {
      const payload = {
        name: formData.name,
        description: formData.description || undefined,
        sku: formData.sku || undefined,
        barcode: formData.barcode || undefined,
        taxCategoryId: formData.taxCategoryId || undefined,
        basePrice: Math.round(parseFloat(formData.basePrice) * 100),
        costPrice: formData.costPrice ? Math.round(parseFloat(formData.costPrice) * 100) : 0,
        categoryId: formData.categoryId || undefined,
        stationId: formData.stationId || undefined,
        imageUrl: formData.imageUrl || undefined,
        isActive: formData.isActive,
        isAvailable: formData.isAvailable,
        // Server expects `prepTimeMinutes`. Same rename as the edit
        // page — was silently dropped when sent as `prepTime`.
        prepTimeMinutes: parseInt(formData.prepTime) || 10,
        taxable: formData.taxable,
        trackInventory: formData.trackInventory,
        durationMinutes: formData.durationMinutes ? parseInt(formData.durationMinutes) : undefined,
        requiresTechnician: businessType === "salon" ? formData.requiresTechnician : undefined,
        modifierGroupIds: selectedModifierGroups,
        allergenIds: selectedAllergens,
        variants: variants.length > 0 ? variants.map((v) => ({
          name: v.name,
          sku: v.sku || undefined,
          price: Math.round(v.price * 100),
          costPrice: Math.round(v.costPrice * 100),
          isAvailable: v.isAvailable,
        })) : undefined,
      };

      const res = await fetch(`/api/tenants/${tenantId}/products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Product created successfully");
        router.push("/dashboard/admin/menu/products");
      } else {
        toast.error(data.error || "Failed to create product");
      }
    } catch (error) {
      toast.error("Failed to create product");
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return "";
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(num);
  };

  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Please select a business first</p>
      </div>
    );
  }

  const isSalon = businessType === "salon";
  // Salon services don't have modifiers/allergens (food-service concepts).
  const tabs = [
    { id: "basic", label: "Basic Info", icon: "solar:document-text-linear" },
    { id: "pricing", label: "Pricing", icon: "solar:tag-price-linear" },
    ...(isSalon
      ? []
      : [{ id: "modifiers", label: "Modifiers", icon: "solar:add-square-linear" }]),
    ...(isSalon
      ? []
      : [{ id: "allergens", label: "Allergens", icon: "solar:danger-triangle-linear" }]),
    { id: "variants", label: "Variants", icon: "solar:copy-linear" },
  ];

  return (
    <div>
      <AdminHeader
        title={businessType === "salon" ? "New Service" : "New Product"}
        subtitle={businessType === "salon" ? "Add a new service to your catalog" : "Add a new item to your menu"}
        backLink="/dashboard/admin/menu/products"
        actions={
          <div className="flex items-center gap-3">
            <Link href="/dashboard/admin/menu/products">
              <Button variant="secondary">Cancel</Button>
            </Link>
            <Button
              icon="solar:check-circle-bold"
              onClick={handleSubmit}
              disabled={saving}
            >
              {saving ? "Saving..." : businessType === "salon" ? "Save Service" : "Save Product"}
            </Button>
          </div>
        }
      />

      <div className="p-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? "bg-indigo-500 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              <Icon icon={tab.icon} className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Basic Info Tab */}
        {activeTab === "basic" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <Card title={businessType === "salon" ? "Service Information" : "Product Information"}>
                <div className="space-y-4">
                  <Input
                    label={businessType === "salon" ? "Service Name" : "Product Name"}
                    placeholder={businessType === "salon" ? "e.g., Haircut & Style" : "e.g., Chicken Burger"}
                    value={formData.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                    required
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="SKU"
                      placeholder={businessType === "salon" ? "e.g., SVC-001" : "e.g., BURG-001"}
                      value={formData.sku}
                      onChange={(e) => handleInputChange("sku", e.target.value)}
                    />
                    <Select
                      label={businessType === "salon" ? "Service Type" : "Category"}
                      options={[
                        { value: "", label: businessType === "salon" ? "Select type" : "Select category" },
                        ...categories.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      value={formData.categoryId}
                      onChange={(e) => handleInputChange("categoryId", e.target.value)}
                    />
                  </div>

                  {/* Barcode — hidden for salon services (never scanned) */}
                  {businessType !== "salon" && (
                    <Input
                      label="Barcode (UPC / EAN)"
                      placeholder="Scan or type — used by POS scanner"
                      value={formData.barcode}
                      onChange={(e) => handleInputChange("barcode", e.target.value)}
                    />
                  )}

                  {/* Tax category — hidden entirely when the tenant hasn't
                      created any categories, since the flat settings.taxRate
                      still applies. */}
                  {taxCategories.length > 0 && (
                    <Select
                      label="Tax Category"
                      options={[
                        { value: "", label: "Use default rate" },
                        ...taxCategories.map((tc) => ({
                          value: tc.id,
                          label: `${tc.name} — ${Number(tc.ratePercent).toFixed(2)}%${tc.isDefault ? " (default)" : ""}`,
                        })),
                      ]}
                      value={formData.taxCategoryId}
                      onChange={(e) => handleInputChange("taxCategoryId", e.target.value)}
                    />
                  )}

                  {/* Salon-specific: Duration & Technician */}
                  {businessType === "salon" && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Input
                        label="Duration (minutes)"
                        placeholder="e.g., 45"
                        type="number"
                        value={formData.durationMinutes}
                        onChange={(e) => handleInputChange("durationMinutes", e.target.value)}
                      />
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Requires Technician</label>
                        <Toggle
                          checked={formData.requiresTechnician}
                          onChange={(val) => handleInputChange("requiresTechnician", val)}
                          label={formData.requiresTechnician ? "Yes — assigned to staff" : "No — walk-in service"}
                        />
                      </div>
                    </div>
                  )}

                  <Input
                    label="Description"
                    placeholder="Brief description of the product..."
                    value={formData.description}
                    onChange={(e) => handleInputChange("description", e.target.value)}
                    multiline
                    rows={3}
                  />

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">
                      Product Image
                    </label>
                    <div className="flex items-start gap-4">
                      <div className="w-24 h-24 rounded-xl bg-gray-100 border-2 border-dashed border-gray-300 overflow-hidden flex-shrink-0">
                        {formData.imageUrl ? (
                          <img
                            src={formData.imageUrl}
                            alt="Preview"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Icon icon="solar:gallery-linear" className="w-8 h-8 text-gray-300" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 space-y-2">
                        <input
                          type="file"
                          id="productImage"
                          accept="image/jpeg,image/png,image/webp"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              if (file.size > 2 * 1024 * 1024) {
                                toast.error("Image must be less than 2MB");
                                return;
                              }
                              const reader = new FileReader();
                              reader.onloadend = () => {
                                handleInputChange("imageUrl", reader.result as string);
                              };
                              reader.readAsDataURL(file);
                            }
                          }}
                          className="hidden"
                        />
                        <label
                          htmlFor="productImage"
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium cursor-pointer transition-colors"
                        >
                          <Icon icon="solar:upload-linear" className="w-4 h-4" />
                          Upload Image
                        </label>
                        <p className="text-xs text-gray-500">PNG, JPG, WebP. Max 2MB</p>
                        {formData.imageUrl && (
                          <button
                            type="button"
                            onClick={() => handleInputChange("imageUrl", "")}
                            className="text-xs text-red-600 hover:text-red-700"
                          >
                            Remove image
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              <Card title={isSalon ? "Service Duration" : "Kitchen Settings"}>
                <div className="space-y-4">
                  <div className={`grid grid-cols-1 ${isSalon ? "" : "sm:grid-cols-2"} gap-4`}>
                    {!isSalon && (
                      <Select
                        label="Kitchen Station"
                        options={[
                          { value: "", label: "Default station" },
                          ...stations.map((s) => ({ value: s.id, label: s.name })),
                        ]}
                        value={formData.stationId}
                        onChange={(e) => handleInputChange("stationId", e.target.value)}
                      />
                    )}
                    <Input
                      label={isSalon ? "Service Duration (minutes)" : "Prep Time (minutes)"}
                      type="number"
                      value={formData.prepTime}
                      onChange={(e) => handleInputChange("prepTime", e.target.value)}
                    />
                  </div>
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              <Card title="Status">
                <div className="space-y-4">
                  <Toggle
                    label="Active"
                    description="Product appears in menu"
                    checked={formData.isActive}
                    onChange={(checked) => handleInputChange("isActive", checked)}
                  />
                  <Toggle
                    label="Available"
                    description="Can be ordered right now"
                    checked={formData.isAvailable}
                    onChange={(checked) => handleInputChange("isAvailable", checked)}
                  />
                  <Toggle
                    label="Track Inventory"
                    description="Deduct ingredients on sale"
                    checked={formData.trackInventory}
                    onChange={(checked) => handleInputChange("trackInventory", checked)}
                  />
                </div>
              </Card>

              {/* Preview */}
              {formData.name && (
                <Card title="Preview">
                  <div className="text-center">
                    <div className="w-24 h-24 mx-auto rounded-2xl bg-gray-100 overflow-hidden mb-3">
                      {formData.imageUrl ? (
                        <img
                          src={formData.imageUrl}
                          alt={formData.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Icon icon="solar:box-bold" className="w-10 h-10 text-gray-300" />
                        </div>
                      )}
                    </div>
                    <h4 className="font-semibold text-gray-900">{formData.name}</h4>
                    {formData.basePrice && (
                      <p className="text-indigo-600 font-medium">
                        {formatCurrency(formData.basePrice)}
                      </p>
                    )}
                    {formData.description && (
                      <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                        {formData.description}
                      </p>
                    )}
                  </div>
                </Card>
              )}
            </div>
          </div>
        )}

        {/* Pricing Tab */}
        {activeTab === "pricing" && (
          <Card title="Pricing & Tax">
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Selling Price"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.basePrice}
                  onChange={(e) => handleInputChange("basePrice", e.target.value)}
                  icon="solar:dollar-linear"
                  required
                  helperText={formData.basePrice ? `Display: ${formatCurrency(formData.basePrice)}` : ""}
                />
                <Input
                  label="Cost Price"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={formData.costPrice}
                  onChange={(e) => handleInputChange("costPrice", e.target.value)}
                  icon="solar:dollar-linear"
                  helperText="For profit calculation"
                />
              </div>

              {formData.basePrice && formData.costPrice && (
                <div className="p-4 bg-gray-50 rounded-xl">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-600">Profit Margin</span>
                    <span className="font-semibold text-green-600">
                      {(
                        ((parseFloat(formData.basePrice) - parseFloat(formData.costPrice)) /
                          parseFloat(formData.basePrice)) *
                        100
                      ).toFixed(1)}
                      %
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-gray-600">Profit Amount</span>
                    <span className="font-semibold text-green-600">
                      {formatCurrency(
                        (parseFloat(formData.basePrice) - parseFloat(formData.costPrice)).toString()
                      )}
                    </span>
                  </div>
                </div>
              )}

              <Toggle
                label="Taxable"
                description="Apply sales tax to this product"
                checked={formData.taxable}
                onChange={(checked) => handleInputChange("taxable", checked)}
              />
            </div>
          </Card>
        )}

        {/* Modifiers Tab */}
        {activeTab === "modifiers" && (
          <Card
            title="Modifier Groups"
            subtitle="Add customization options to this product"
          >
            {modifierGroups.length === 0 ? (
              <div className="text-center py-8">
                <Icon icon="solar:add-square-linear" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 mb-3">No modifier groups created yet</p>
                <Link href="/dashboard/admin/menu/modifiers">
                  <Button variant="secondary" size="sm">
                    Create Modifiers
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {modifierGroups.map((group) => (
                  <label
                    key={group.id}
                    className={`flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedModifierGroups.includes(group.id)
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedModifierGroups.includes(group.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedModifierGroups([...selectedModifierGroups, group.id]);
                        } else {
                          setSelectedModifierGroups(
                            selectedModifierGroups.filter((id) => id !== group.id)
                          );
                        }
                      }}
                      className="w-5 h-5 rounded text-indigo-500 mt-0.5"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{group.name}</span>
                        {group.required && (
                          <Badge variant="danger" size="sm">Required</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        {group.minSelections > 0 && `Min ${group.minSelections}`}
                        {group.minSelections > 0 && group.maxSelections > 0 && " - "}
                        {group.maxSelections > 0 && `Max ${group.maxSelections}`}
                        {!group.minSelections && !group.maxSelections && "Optional"}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {group.modifiers.slice(0, 5).map((mod) => (
                          <span
                            key={mod.id}
                            className="text-xs px-2 py-1 bg-gray-100 rounded-full text-gray-600"
                          >
                            {mod.name}
                            {mod.price > 0 && ` +${formatCurrency((mod.price / 100).toString())}`}
                          </span>
                        ))}
                        {group.modifiers.length > 5 && (
                          <span className="text-xs px-2 py-1 text-gray-400">
                            +{group.modifiers.length - 5} more
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Allergens Tab */}
        {activeTab === "allergens" && (
          <Card
            title="Allergens"
            subtitle="Select all allergens present in this product"
          >
            {allergens.length === 0 ? (
              <div className="text-center py-8">
                <Icon icon="solar:danger-triangle-linear" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 mb-3">No allergens configured</p>
                <Link href="/dashboard/admin/menu/allergens">
                  <Button variant="secondary" size="sm">
                    Configure Allergens
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {allergens.map((allergen) => (
                  <label
                    key={allergen.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      selectedAllergens.includes(allergen.id)
                        ? "border-amber-500 bg-amber-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedAllergens.includes(allergen.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedAllergens([...selectedAllergens, allergen.id]);
                        } else {
                          setSelectedAllergens(
                            selectedAllergens.filter((id) => id !== allergen.id)
                          );
                        }
                      }}
                      className="w-5 h-5 rounded text-amber-500"
                    />
                    <span className="text-2xl">{allergen.icon}</span>
                    <span className="font-medium text-gray-700">{allergen.name}</span>
                  </label>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Variants Tab */}
        {activeTab === "variants" && (
          <Card
            title="Product Variants"
            subtitle="Add size or flavor variations with different prices"
            actions={
              <Button
                variant="secondary"
                size="sm"
                icon="solar:add-circle-linear"
                onClick={addVariant}
              >
                Add Variant
              </Button>
            }
          >
            {variants.length === 0 ? (
              <div className="text-center py-8">
                <Icon icon="solar:copy-linear" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 mb-3">No variants added</p>
                <p className="text-sm text-gray-400">
                  Use variants for different sizes (Small, Medium, Large) or flavors
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {variants.map((variant, index) => (
                  <div
                    key={index}
                    className="p-4 border border-gray-200 rounded-xl space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700">Variant {index + 1}</span>
                      <button
                        onClick={() => removeVariant(index)}
                        className="text-red-500 hover:text-red-600"
                      >
                        <Icon icon="solar:trash-bin-trash-linear" className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <Input
                        label="Variant Name"
                        placeholder="e.g., Large"
                        value={variant.name}
                        onChange={(e) => updateVariant(index, "name", e.target.value)}
                        required
                      />
                      <Input
                        label="SKU"
                        placeholder="Optional"
                        value={variant.sku}
                        onChange={(e) => updateVariant(index, "sku", e.target.value)}
                      />
                      <Input
                        label="Price"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={variant.price || ""}
                        onChange={(e) =>
                          updateVariant(index, "price", parseFloat(e.target.value) || 0)
                        }
                      />
                      <Input
                        label="Cost"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={variant.costPrice || ""}
                        onChange={(e) =>
                          updateVariant(index, "costPrice", parseFloat(e.target.value) || 0)
                        }
                      />
                    </div>
                    <Toggle
                      label="Available"
                      checked={variant.isAvailable}
                      onChange={(checked) => updateVariant(index, "isAvailable", checked)}
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
