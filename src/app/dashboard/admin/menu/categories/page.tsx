"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Modal, Card } from "@/components/ui";

interface Category {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  sortOrder: number;
  isActive: boolean;
  _count: { products: number };
}

export default function CategoriesPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    imageUrl: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const loadCategories = useCallback(async () => {
    if (!tenantId) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/categories?includeInactive=true`);
      const data = await res.json();
      if (data.success) {
        setCategories(data.categories);
      }
    } catch (error) {
      toast.error("Failed to load categories");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const openCreateModal = () => {
    setEditingCategory(null);
    setFormData({ name: "", description: "", imageUrl: "" });
    setModalOpen(true);
  };

  const openEditModal = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      description: category.description || "",
      imageUrl: category.imageUrl || "",
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Category name is required");
      return;
    }

    setSaving(true);
    try {
      const url = editingCategory
        ? `/api/tenants/${tenantId}/categories/${editingCategory.id}`
        : `/api/tenants/${tenantId}/categories`;

      const res = await fetch(url, {
        method: editingCategory ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(editingCategory ? "Category updated" : "Category created");
        setModalOpen(false);
        loadCategories();
      } else {
        toast.error(data.error || "Failed to save category");
      }
    } catch (error) {
      toast.error("Failed to save category");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (category: Category) => {
    try {
      const res = await fetch(`/api/tenants/${tenantId}/categories/${category.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !category.isActive }),
      });

      if ((await res.json()).success) {
        toast.success(category.isActive ? "Category hidden" : "Category visible");
        loadCategories();
      }
    } catch (error) {
      toast.error("Failed to update category");
    }
  };

  const handleDelete = async (category: Category) => {
    if (!confirm(`Delete "${category.name}"?`)) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/categories/${category.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (data.success) {
        toast.success(data.softDeleted ? "Category deactivated" : "Category deleted");
        loadCategories();
      } else {
        toast.error(data.error || "Failed to delete category");
      }
    } catch (error) {
      toast.error("Failed to delete category");
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
        title="Categories"
        subtitle="Organize your menu with categories"
        actions={
          <Button icon="solar:add-circle-bold" onClick={openCreateModal}>
            Add Category
          </Button>
        }
      />

      <div className="p-6">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-32 bg-gray-200 rounded-xl mb-4" />
                <div className="h-5 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
            ))}
          </div>
        ) : categories.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:folder-open-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No categories yet</h3>
            <p className="text-gray-500 mb-4">Create your first category to organize your menu</p>
            <Button icon="solar:add-circle-bold" onClick={openCreateModal}>
              Add Category
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {categories.map((category) => (
              <Card
                key={category.id}
                className={`relative overflow-hidden ${!category.isActive ? "opacity-60" : ""}`}
                padding="none"
              >
                {/* Image */}
                <div className="aspect-video bg-gradient-to-br from-teal-100 to-cyan-50 relative">
                  {category.imageUrl ? (
                    <img
                      src={category.imageUrl}
                      alt={category.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Icon icon="solar:folder-bold" className="w-12 h-12 text-teal-300" />
                    </div>
                  )}

                  {/* Status Badge */}
                  {!category.isActive && (
                    <div className="absolute top-2 right-2 px-2 py-1 rounded-full bg-gray-900/70 text-white text-xs font-medium">
                      Hidden
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 mb-1">{category.name}</h3>
                  {category.description && (
                    <p className="text-sm text-gray-500 line-clamp-2 mb-2">
                      {category.description}
                    </p>
                  )}
                  <p className="text-sm text-gray-400">
                    {category._count.products} product{category._count.products !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Actions */}
                <div className="px-4 pb-4 flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openEditModal(category)}
                    className="flex-1"
                  >
                    <Icon icon="solar:pen-linear" className="w-4 h-4 mr-1" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleToggleActive(category)}
                  >
                    <Icon
                      icon={category.isActive ? "solar:eye-closed-linear" : "solar:eye-linear"}
                      className="w-4 h-4"
                    />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(category)}
                    className="text-red-600 hover:bg-red-50"
                  >
                    <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingCategory ? "Edit Category" : "New Category"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} loading={saving}>
              {editingCategory ? "Save Changes" : "Create Category"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Category Name"
            placeholder="e.g., Appetizers, Main Course, Drinks"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <Input
            label="Description (optional)"
            placeholder="Brief description of this category"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
          <Input
            label="Image URL (optional)"
            placeholder="https://example.com/image.jpg"
            value={formData.imageUrl}
            onChange={(e) => setFormData({ ...formData, imageUrl: e.target.value })}
            hint="Enter an external image URL"
          />
          {formData.imageUrl && (
            <div className="rounded-xl overflow-hidden border border-gray-200">
              <img
                src={formData.imageUrl}
                alt="Preview"
                className="w-full h-40 object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
