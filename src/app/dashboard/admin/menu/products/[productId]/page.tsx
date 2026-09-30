"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import Link from "next/link";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Select, Card, Toggle, Badge, Modal } from "@/components/ui";

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

interface Ingredient {
  id: string;
  name: string;
  unit?: { abbreviation: string };
}

interface RecipeItem {
  ingredientId: string;
  ingredient: Ingredient;
  quantity: number;
  unitId?: string;
}

export default function EditProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currency, setCurrency] = useState("CAD");
  const [showDeleteModal, setShowDeleteModal] = useState(false);

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
  });

  // Business type — drives whether kitchen / allergens / recipe tabs
  // show (food-service concepts, irrelevant for salon services).
  const [businessType, setBusinessType] = useState<string>("restaurant");
  const isSalon = businessType === "salon";

  // Related data
  const [categories, setCategories] = useState<Category[]>([]);
  const [taxCategories, setTaxCategories] = useState<Array<{ id: string; name: string; ratePercent: string; isDefault: boolean }>>([]);
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [allergens, setAllergens] = useState<Allergen[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);

  // Selected items
  const [selectedModifierGroups, setSelectedModifierGroups] = useState<string[]>([]);
  const [selectedAllergens, setSelectedAllergens] = useState<string[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [recipe, setRecipe] = useState<RecipeItem[]>([]);

  // Active tab
  const [activeTab, setActiveTab] = useState<"basic" | "pricing" | "modifiers" | "allergens" | "variants" | "recipe">("basic");

  useEffect(() => {
    const storedTenant = localStorage.getItem("tap_active_tenant");
    const storedLocation = localStorage.getItem("tap_active_location");
    if (storedTenant) setTenantId(storedTenant);
    if (storedLocation) setLocationId(storedLocation);
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    loadData();
  }, [tenantId, locationId, productId]);

  const loadData = async () => {
    try {
      const [productRes, categoriesRes, modifiersRes, allergensRes, settingsRes, ingredientsRes, taxRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/products/${productId}`),
        fetch(`/api/tenants/${tenantId}/categories`),
        fetch(`/api/tenants/${tenantId}/modifier-groups`),
        fetch(`/api/tenants/${tenantId}/allergens`),
        fetch(`/api/tenants/${tenantId}/settings`),
        fetch(`/api/tenants/${tenantId}/ingredients`),
        fetch(`/api/tenants/${tenantId}/tax-categories`),
      ]);

      const [productData, categoriesData, modifiersData, allergensData, settingsData, ingredientsData, taxData] = await Promise.all([
        productRes.json(),
        categoriesRes.json(),
        modifiersRes.json(),
        allergensRes.json(),
        settingsRes.json(),
        ingredientsRes.json(),
        taxRes.json(),
      ]);

      if (categoriesData.success) setCategories(categoriesData.categories);
      if (modifiersData.success) setModifierGroups(modifiersData.modifierGroups);
      if (allergensData.success) setAllergens(allergensData.allergens);
      if (settingsData.success) {
        setCurrency(settingsData.tenant?.currency || "CAD");
        if (settingsData.tenant?.businessType) {
          setBusinessType(settingsData.tenant.businessType);
        }
      }
      if (ingredientsData.success) setIngredients(ingredientsData.ingredients);
      if (taxData.success) setTaxCategories(taxData.categories || []);

      if (productData.success) {
        const p = productData.product;
        setFormData({
          name: p.name || "",
          description: p.description || "",
          sku: p.sku || "",
          barcode: p.barcode || "",
          taxCategoryId: p.taxCategoryId || "",
          basePrice: (p.basePrice / 100).toFixed(2),
          costPrice: p.costPrice ? (p.costPrice / 100).toFixed(2) : "",
          categoryId: p.categoryId || "",
          stationId: p.stationId || "",
          imageUrl: p.imageUrl || "",
          isActive: p.isActive ?? true,
          isAvailable: p.isAvailable ?? true,
          // Server column is `prepTimeMinutes`. The old code read
          // `p.prepTime` (undefined) so the field always defaulted to
          // 10 and the actual DB value never surfaced. Same rename on
          // the save side below.
          prepTime: p.prepTimeMinutes?.toString() || "10",
          taxable: p.taxable ?? true,
          trackInventory: p.trackInventory ?? false,
        });

        setSelectedModifierGroups(p.productModifierGroups?.map((g: any) => g.modifierGroupId) || []);
        setSelectedAllergens(p.productAllergens?.map((a: any) => a.allergenId) || []);
        setVariants(p.variants?.map((v: any) => ({
          id: v.id,
          name: v.name,
          sku: v.sku || "",
          price: v.price / 100,
          costPrice: v.costPrice ? v.costPrice / 100 : 0,
          isAvailable: v.isAvailable ?? true,
        })) || []);
        setRecipe(p.recipe || []);
      }

      // Load stations if location selected
      if (locationId) {
        const stationsRes = await fetch(`/api/tenants/${tenantId}/locations/${locationId}/stations`);
        const stationsData = await stationsRes.json();
        if (stationsData.success) setStations(stationsData.stations);
      }
    } catch (error) {
      toast.error("Failed to load product");
    } finally {
      setLoading(false);
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

  const addRecipeItem = () => {
    if (ingredients.length === 0) {
      toast.error("No ingredients available. Create ingredients first.");
      return;
    }
    setRecipe([
      ...recipe,
      { ingredientId: "", ingredient: {} as Ingredient, quantity: 1 },
    ]);
  };

  const updateRecipeItem = (index: number, field: string, value: any) => {
    setRecipe((prev) => {
      const updated = [...prev];
      if (field === "ingredientId") {
        const ingredient = ingredients.find((i) => i.id === value);
        updated[index] = { ...updated[index], ingredientId: value, ingredient: ingredient! };
      } else {
        updated[index] = { ...updated[index], [field]: value };
      }
      return updated;
    });
  };

  const removeRecipeItem = (index: number) => {
    setRecipe((prev) => prev.filter((_, i) => i !== index));
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
        taxCategoryId: formData.taxCategoryId || null,
        basePrice: Math.round(parseFloat(formData.basePrice) * 100),
        costPrice: formData.costPrice ? Math.round(parseFloat(formData.costPrice) * 100) : 0,
        categoryId: formData.categoryId || null,
        stationId: formData.stationId || null,
        imageUrl: formData.imageUrl || undefined,
        isActive: formData.isActive,
        isAvailable: formData.isAvailable,
        // Server expects `prepTimeMinutes`. Was sent as `prepTime`
        // which the API silently ignored — column stayed null and the
        // appointment slot picker showed "0 min" for every service.
        prepTimeMinutes: parseInt(formData.prepTime) || 10,
        taxable: formData.taxable,
        trackInventory: formData.trackInventory,
        modifierGroupIds: selectedModifierGroups,
        allergenIds: selectedAllergens,
        variants: variants.map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.sku || undefined,
          price: Math.round(v.price * 100),
          costPrice: Math.round(v.costPrice * 100),
          isAvailable: v.isAvailable,
        })),
      };

      const res = await fetch(`/api/tenants/${tenantId}/products/${productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        // Update recipe separately if changed
        if (recipe.length > 0) {
          await fetch(`/api/tenants/${tenantId}/products/${productId}/recipe`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ingredients: recipe
                .filter((r) => r.ingredientId)
                .map((r) => ({
                  ingredientId: r.ingredientId,
                  quantity: r.quantity,
                })),
            }),
          });
        }

        toast.success("Product updated successfully");
        router.push("/dashboard/admin/menu/products");
      } else {
        toast.error(data.error || "Failed to update product");
      }
    } catch (error) {
      toast.error("Failed to update product");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/products/${productId}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (data.success) {
        toast.success(data.softDeleted ? "Product deactivated" : "Product deleted");
        router.push("/dashboard/admin/menu/products");
      } else {
        toast.error(data.error || "Failed to delete product");
      }
    } catch (error) {
      toast.error("Failed to delete product");
    }
    setShowDeleteModal(false);
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

  if (loading) {
    return (
      <div>
        <AdminHeader title="Edit Product" subtitle="Loading..." backLink="/dashboard/admin/menu/products" />
        <div className="p-6">
          <Card>
            <div className="animate-pulse space-y-4">
              <div className="h-10 bg-gray-200 rounded w-1/3" />
              <div className="h-10 bg-gray-200 rounded w-full" />
              <div className="h-10 bg-gray-200 rounded w-2/3" />
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // Tabs: allergens + recipe + modifiers hide for salon (food-service
  // concepts). Salon keeps Basic Info + Pricing + Variants (variants =
  // "Small / Medium / Long hair", useful for services with tiers).
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
    ...(isSalon
      ? []
      : [{ id: "recipe", label: "Recipe", icon: "solar:chef-hat-linear" }]),
  ];

  return (
    <div>
      <AdminHeader
        title={`Edit: ${formData.name}`}
        subtitle="Update product details"
        backLink="/dashboard/admin/menu/products"
        actions={
          <div className="flex items-center gap-3">
            <Button
              variant="danger"
              icon="solar:trash-bin-trash-linear"
              onClick={() => setShowDeleteModal(true)}
            >
              Delete
            </Button>
            <Link href="/dashboard/admin/menu/products">
              <Button variant="secondary">Cancel</Button>
            </Link>
            <Button
              icon="solar:check-circle-bold"
              onClick={handleSubmit}
              disabled={saving}
            >
              {saving ? "Saving..." : "Save Changes"}
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
              <Card title="Product Information">
                <div className="space-y-4">
                  <Input
                    label="Product Name"
                    placeholder="e.g., Chicken Burger"
                    value={formData.name}
                    onChange={(e) => handleInputChange("name", e.target.value)}
                    required
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="SKU"
                      placeholder="e.g., BURG-001"
                      value={formData.sku}
                      onChange={(e) => handleInputChange("sku", e.target.value)}
                    />
                    <Select
                      label="Category"
                      options={[
                        { value: "", label: "Select category" },
                        ...categories.map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      value={formData.categoryId}
                      onChange={(e) => handleInputChange("categoryId", e.target.value)}
                    />
                  </div>

                  <Input
                    label="Barcode (UPC / EAN)"
                    placeholder="Scan or type — used by POS scanner"
                    value={formData.barcode}
                    onChange={(e) => handleInputChange("barcode", e.target.value)}
                  />

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

              {/* Kitchen/prep card — for salon the whole thing becomes
                  "Service Duration" (no kitchen station concept). For
                  restaurant/retail it stays as-is. */}
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
                  <div className="flex flex-wrap gap-1 justify-center mt-2">
                    {!formData.isActive && <Badge variant="danger" size="sm">Inactive</Badge>}
                    {!formData.isAvailable && formData.isActive && <Badge variant="warning" size="sm">Sold Out</Badge>}
                    {selectedAllergens.length > 0 && (
                      <Badge variant="warning" size="sm">
                        {selectedAllergens.length} allergen{selectedAllergens.length !== 1 && "s"}
                      </Badge>
                    )}
                  </div>
                </div>
              </Card>
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
                    key={variant.id || index}
                    className="p-4 border border-gray-200 rounded-xl space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-700">
                        {variant.id ? variant.name || `Variant ${index + 1}` : `New Variant ${index + 1}`}
                      </span>
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

        {/* Recipe Tab */}
        {activeTab === "recipe" && (
          <Card
            title="Recipe / Ingredients"
            subtitle="Define ingredients to track inventory and calculate food cost"
            actions={
              <Button
                variant="secondary"
                size="sm"
                icon="solar:add-circle-linear"
                onClick={addRecipeItem}
              >
                Add Ingredient
              </Button>
            }
          >
            {recipe.length === 0 ? (
              <div className="text-center py-8">
                <Icon icon="solar:chef-hat-linear" className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 mb-3">No recipe defined</p>
                <p className="text-sm text-gray-400">
                  Add ingredients to automatically track inventory when this product is sold
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {recipe.map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-4 p-4 border border-gray-200 rounded-xl"
                  >
                    <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Select
                        label="Ingredient"
                        options={[
                          { value: "", label: "Select ingredient" },
                          ...ingredients.map((i) => ({ value: i.id, label: i.name })),
                        ]}
                        value={item.ingredientId}
                        onChange={(e) => updateRecipeItem(index, "ingredientId", e.target.value)}
                      />
                      <Input
                        label={`Quantity ${item.ingredient?.unit?.abbreviation ? `(${item.ingredient.unit.abbreviation})` : ""}`}
                        type="number"
                        step="0.01"
                        value={item.quantity}
                        onChange={(e) =>
                          updateRecipeItem(index, "quantity", parseFloat(e.target.value) || 0)
                        }
                      />
                    </div>
                    <button
                      onClick={() => removeRecipeItem(index)}
                      className="text-red-500 hover:text-red-600 mt-6"
                    >
                      <Icon icon="solar:trash-bin-trash-linear" className="w-5 h-5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {ingredients.length === 0 && (
              <div className="mt-4 p-4 bg-amber-50 rounded-xl text-amber-800 text-sm">
                <Icon icon="solar:info-circle-linear" className="w-5 h-5 inline mr-2" />
                You need to create ingredients first before defining recipes.{" "}
                <Link href="/dashboard/admin/inventory/ingredients" className="underline font-medium">
                  Go to Ingredients
                </Link>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Product"
        size="sm"
      >
        <p className="text-gray-600 mb-6">
          Are you sure you want to delete <strong>{formData.name}</strong>?
          {variants.length > 0 && ` This will also delete ${variants.length} variant(s).`}
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete Product
          </Button>
        </div>
      </Modal>
    </div>
  );
}
