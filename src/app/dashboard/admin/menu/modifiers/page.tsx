"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import AdminHeader from "@/components/admin/AdminHeader";
import { Button, Input, Card, Badge, Modal, Toggle } from "@/components/ui";

interface Modifier {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  sortOrder: number;
}

interface ModifierGroup {
  id: string;
  name: string;
  description?: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  modifiers: Modifier[];
  _count?: { products: number };
}

export default function ModifiersPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("CAD");

  // Modal states
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [showModifierModal, setShowModifierModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ModifierGroup | null>(null);
  const [editingModifier, setEditingModifier] = useState<{ groupId: string; modifier: Modifier | null } | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  // Form data
  const [groupForm, setGroupForm] = useState({
    name: "",
    description: "",
    required: false,
    minSelections: 0,
    maxSelections: 0,
  });

  const [modifierForm, setModifierForm] = useState({
    name: "",
    price: "",
    isAvailable: true,
  });

  useEffect(() => {
    const stored = localStorage.getItem("tap_active_tenant");
    if (stored) setTenantId(stored);
  }, []);

  const loadData = useCallback(async () => {
    if (!tenantId) return;

    try {
      const [groupsRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/modifier-groups`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);

      const [groupsData, settingsData] = await Promise.all([
        groupsRes.json(),
        settingsRes.json(),
      ]);

      if (groupsData.success) setGroups(groupsData.modifierGroups);
      if (settingsData.success) setCurrency(settingsData.tenant?.currency || "CAD");
    } catch (error) {
      toast.error("Failed to load modifiers");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const openGroupModal = (group?: ModifierGroup) => {
    if (group) {
      setEditingGroup(group);
      setGroupForm({
        name: group.name,
        description: group.description || "",
        required: group.required,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
      });
    } else {
      setEditingGroup(null);
      setGroupForm({
        name: "",
        description: "",
        required: false,
        minSelections: 0,
        maxSelections: 0,
      });
    }
    setShowGroupModal(true);
  };

  const openModifierModal = (groupId: string, modifier?: Modifier) => {
    if (modifier) {
      setEditingModifier({ groupId, modifier });
      setModifierForm({
        name: modifier.name,
        price: (modifier.price / 100).toFixed(2),
        isAvailable: modifier.isAvailable,
      });
    } else {
      setEditingModifier({ groupId, modifier: null });
      setModifierForm({
        name: "",
        price: "",
        isAvailable: true,
      });
    }
    setShowModifierModal(true);
  };

  const handleSaveGroup = async () => {
    if (!groupForm.name.trim()) {
      toast.error("Group name is required");
      return;
    }

    try {
      const payload = {
        name: groupForm.name,
        description: groupForm.description || undefined,
        required: groupForm.required,
        minSelections: groupForm.minSelections,
        maxSelections: groupForm.maxSelections,
      };

      const url = editingGroup
        ? `/api/tenants/${tenantId}/modifier-groups/${editingGroup.id}`
        : `/api/tenants/${tenantId}/modifier-groups`;

      const res = await fetch(url, {
        method: editingGroup ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.success) {
        toast.success(editingGroup ? "Group updated" : "Group created");
        setShowGroupModal(false);
        loadData();
      } else {
        toast.error(data.error || "Failed to save group");
      }
    } catch (error) {
      toast.error("Failed to save group");
    }
  };

  const handleDeleteGroup = async (group: ModifierGroup) => {
    if (!confirm(`Delete "${group.name}" and all its modifiers?`)) return;

    try {
      const res = await fetch(`/api/tenants/${tenantId}/modifier-groups/${group.id}`, {
        method: "DELETE",
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Group deleted");
        loadData();
      } else {
        toast.error(data.error || "Failed to delete group");
      }
    } catch (error) {
      toast.error("Failed to delete group");
    }
  };

  const handleSaveModifier = async () => {
    if (!modifierForm.name.trim()) {
      toast.error("Modifier name is required");
      return;
    }

    if (!editingModifier) return;

    try {
      const payload = {
        name: modifierForm.name,
        price: modifierForm.price ? Math.round(parseFloat(modifierForm.price) * 100) : 0,
        isAvailable: modifierForm.isAvailable,
      };

      // If editing existing modifier
      if (editingModifier.modifier) {
        // Use group update to modify modifiers
        const group = groups.find((g) => g.id === editingModifier.groupId);
        if (group) {
          const updatedModifiers = group.modifiers.map((m) =>
            m.id === editingModifier.modifier?.id
              ? { ...m, ...payload }
              : m
          );

          const res = await fetch(`/api/tenants/${tenantId}/modifier-groups/${editingModifier.groupId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modifiers: updatedModifiers.map((m) => ({
                id: m.id,
                name: m.name,
                price: m.price,
                isAvailable: m.isAvailable,
                sortOrder: m.sortOrder,
              })),
            }),
          });

          const data = await res.json();

          if (data.success) {
            toast.success("Modifier updated");
            setShowModifierModal(false);
            loadData();
          } else {
            toast.error(data.error || "Failed to update modifier");
          }
        }
      } else {
        // Adding new modifier
        const group = groups.find((g) => g.id === editingModifier.groupId);
        if (group) {
          const newModifiers = [
            ...group.modifiers.map((m) => ({
              id: m.id,
              name: m.name,
              price: m.price,
              isAvailable: m.isAvailable,
              sortOrder: m.sortOrder,
            })),
            {
              name: payload.name,
              price: payload.price,
              isAvailable: payload.isAvailable,
              sortOrder: group.modifiers.length,
            },
          ];

          const res = await fetch(`/api/tenants/${tenantId}/modifier-groups/${editingModifier.groupId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modifiers: newModifiers }),
          });

          const data = await res.json();

          if (data.success) {
            toast.success("Modifier added");
            setShowModifierModal(false);
            loadData();
          } else {
            toast.error(data.error || "Failed to add modifier");
          }
        }
      }
    } catch (error) {
      toast.error("Failed to save modifier");
    }
  };

  const handleDeleteModifier = async (groupId: string, modifierId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;

    const modifier = group.modifiers.find((m) => m.id === modifierId);
    if (!confirm(`Delete "${modifier?.name}"?`)) return;

    try {
      const updatedModifiers = group.modifiers
        .filter((m) => m.id !== modifierId)
        .map((m, index) => ({
          id: m.id,
          name: m.name,
          price: m.price,
          isAvailable: m.isAvailable,
          sortOrder: index,
        }));

      const res = await fetch(`/api/tenants/${tenantId}/modifier-groups/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modifiers: updatedModifiers }),
      });

      const data = await res.json();

      if (data.success) {
        toast.success("Modifier deleted");
        loadData();
      } else {
        toast.error(data.error || "Failed to delete modifier");
      }
    } catch (error) {
      toast.error("Failed to delete modifier");
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
        title="Modifiers"
        subtitle={`${groups.length} modifier group${groups.length !== 1 ? "s" : ""}`}
        actions={
          <Button icon="solar:add-circle-bold" onClick={() => openGroupModal()}>
            Add Group
          </Button>
        }
      />

      <div className="p-6">
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} padding="none">
                <div className="animate-pulse p-4">
                  <div className="h-6 bg-gray-200 rounded w-1/4 mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-1/3" />
                </div>
              </Card>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <Card className="text-center py-12">
            <Icon icon="solar:add-square-linear" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No modifier groups</h3>
            <p className="text-gray-500 mb-4">
              Create modifier groups like "Toppings" or "Extras" for your products
            </p>
            <Button icon="solar:add-circle-bold" onClick={() => openGroupModal()}>
              Create First Group
            </Button>
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <Card key={group.id} padding="none" className="overflow-hidden">
                {/* Group Header */}
                <div
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50"
                  onClick={() => setExpandedGroup(expandedGroup === group.id ? null : group.id)}
                >
                  <div className="flex items-center gap-4">
                    <button className="text-gray-400">
                      <Icon
                        icon={expandedGroup === group.id ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"}
                        className="w-5 h-5"
                      />
                    </button>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{group.name}</h3>
                        {group.required && <Badge variant="danger" size="sm">Required</Badge>}
                        <Badge variant="gray" size="sm">
                          {group.modifiers.length} option{group.modifiers.length !== 1 && "s"}
                        </Badge>
                      </div>
                      {group.description && (
                        <p className="text-sm text-gray-500 mt-0.5">{group.description}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {group.minSelections > 0 && `Min ${group.minSelections}`}
                        {group.minSelections > 0 && group.maxSelections > 0 && " • "}
                        {group.maxSelections > 0 && `Max ${group.maxSelections}`}
                        {!group.minSelections && !group.maxSelections && "Any selection"}
                        {group._count?.products !== undefined && ` • Used by ${group._count.products} product(s)`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => openGroupModal(group)}
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                    >
                      <Icon icon="solar:pen-linear" className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteGroup(group)}
                      className="p-2 rounded-lg hover:bg-red-50 text-red-500"
                    >
                      <Icon icon="solar:trash-bin-trash-linear" className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                {/* Modifiers List */}
                {expandedGroup === group.id && (
                  <div className="border-t border-gray-100">
                    {group.modifiers.length === 0 ? (
                      <div className="p-4 text-center text-gray-500">
                        No modifiers in this group
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-100">
                        {group.modifiers.map((modifier) => (
                          <div
                            key={modifier.id}
                            className="flex items-center justify-between px-4 py-3 pl-12 hover:bg-gray-50"
                          >
                            <div className="flex items-center gap-3">
                              <Icon icon="solar:widget-2-linear" className="w-5 h-5 text-gray-400" />
                              <span className={modifier.isAvailable ? "text-gray-900" : "text-gray-400 line-through"}>
                                {modifier.name}
                              </span>
                              {!modifier.isAvailable && (
                                <Badge variant="warning" size="sm">Unavailable</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-4">
                              <span className={`font-medium ${modifier.price > 0 ? "text-teal-600" : "text-gray-400"}`}>
                                {modifier.price > 0 ? `+${formatPrice(modifier.price)}` : "Free"}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => openModifierModal(group.id, modifier)}
                                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                                >
                                  <Icon icon="solar:pen-linear" className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteModifier(group.id, modifier.id)}
                                  className="p-1.5 rounded-lg hover:bg-red-50 text-red-500"
                                >
                                  <Icon icon="solar:trash-bin-trash-linear" className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="p-3 bg-gray-50 border-t border-gray-100">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="solar:add-circle-linear"
                        onClick={() => openModifierModal(group.id)}
                      >
                        Add Modifier
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Group Modal */}
      <Modal
        isOpen={showGroupModal}
        onClose={() => setShowGroupModal(false)}
        title={editingGroup ? "Edit Modifier Group" : "New Modifier Group"}
      >
        <div className="space-y-4">
          <Input
            label="Group Name"
            placeholder="e.g., Toppings, Extras, Size"
            value={groupForm.name}
            onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
            required
          />

          <Input
            label="Description"
            placeholder="Optional description..."
            value={groupForm.description}
            onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
            multiline
            rows={2}
          />

          <Toggle
            label="Required"
            description="Customer must select from this group"
            checked={groupForm.required}
            onChange={(checked) => setGroupForm({ ...groupForm, required: checked })}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Min Selections"
              type="number"
              min={0}
              value={groupForm.minSelections}
              onChange={(e) => setGroupForm({ ...groupForm, minSelections: parseInt(e.target.value) || 0 })}
              helperText="0 = optional"
            />
            <Input
              label="Max Selections"
              type="number"
              min={0}
              value={groupForm.maxSelections}
              onChange={(e) => setGroupForm({ ...groupForm, maxSelections: parseInt(e.target.value) || 0 })}
              helperText="0 = unlimited"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowGroupModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveGroup}>
              {editingGroup ? "Save Changes" : "Create Group"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modifier Modal */}
      <Modal
        isOpen={showModifierModal}
        onClose={() => setShowModifierModal(false)}
        title={editingModifier?.modifier ? "Edit Modifier" : "Add Modifier"}
        size="sm"
      >
        <div className="space-y-4">
          <Input
            label="Modifier Name"
            placeholder="e.g., Extra Cheese, Large"
            value={modifierForm.name}
            onChange={(e) => setModifierForm({ ...modifierForm, name: e.target.value })}
            required
          />

          <Input
            label="Additional Price"
            type="number"
            step="0.01"
            placeholder="0.00"
            value={modifierForm.price}
            onChange={(e) => setModifierForm({ ...modifierForm, price: e.target.value })}
            icon="solar:dollar-linear"
            helperText="Leave empty or 0 for no extra charge"
          />

          <Toggle
            label="Available"
            description="Can be selected by customers"
            checked={modifierForm.isAvailable}
            onChange={(checked) => setModifierForm({ ...modifierForm, isAvailable: checked })}
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="secondary" onClick={() => setShowModifierModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveModifier}>
              {editingModifier?.modifier ? "Save Changes" : "Add Modifier"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
