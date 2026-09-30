"use client";

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import { Button, Modal, Badge } from "../ui";

interface Variant {
  id: string;
  name: string;
  priceAdjustment: number;
}

interface Modifier {
  id: string;
  name: string;
  price: number;
  isDefault?: boolean;
}

interface ModifierGroup {
  id: string;
  name: string;
  displayName: string;
  isRequired: boolean;
  minSelect: number;
  maxSelect: number;
  modifiers: Modifier[];
}

interface Allergen {
  id: string;
  name: string;
  icon: string;
  severity: string;
}

interface ProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: {
    id: string;
    name: string;
    description?: string;
    basePrice: number;
    imageUrl?: string;
    variants?: Variant[];
    modifierGroups?: ModifierGroup[];
    allergens?: Allergen[];
  } | null;
  currency?: string;
  onAddToCart: (data: {
    productId: string;
    variantId?: string;
    quantity: number;
    modifiers: { modifierId: string; quantity: number }[];
    specialInstructions?: string;
    allergyNotes?: { allergenId: string; note: string }[];
  }) => void;
}

export default function ProductModal({
  isOpen,
  onClose,
  product,
  currency = "CAD",
  onAddToCart,
}: ProductModalProps) {
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [selectedModifiers, setSelectedModifiers] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [specialInstructions, setSpecialInstructions] = useState("");
  const [allergyNotes, setAllergyNotes] = useState<{ allergenId: string; note: string }[]>([]);

  // Reset state when product changes
  useEffect(() => {
    if (product) {
      setSelectedVariant(product.variants?.[0]?.id || null);
      setQuantity(1);
      setSpecialInstructions("");
      setAllergyNotes([]);

      // Set default modifiers
      const defaults: Record<string, string[]> = {};
      product.modifierGroups?.forEach((group) => {
        const defaultMods = group.modifiers
          .filter((m) => m.isDefault)
          .map((m) => m.id);
        if (defaultMods.length > 0) {
          defaults[group.id] = defaultMods;
        }
      });
      setSelectedModifiers(defaults);
    }
  }, [product]);

  if (!product) return null;

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  const handleModifierToggle = (groupId: string, modifierId: string, maxSelect: number) => {
    setSelectedModifiers((prev) => {
      const current = prev[groupId] || [];
      const isSelected = current.includes(modifierId);

      if (isSelected) {
        return { ...prev, [groupId]: current.filter((id) => id !== modifierId) };
      } else {
        if (maxSelect === 1) {
          return { ...prev, [groupId]: [modifierId] };
        } else if (current.length < maxSelect) {
          return { ...prev, [groupId]: [...current, modifierId] };
        }
        return prev;
      }
    });
  };

  const handleAllergyToggle = (allergenId: string, allergenName: string) => {
    setAllergyNotes((prev) => {
      const existing = prev.find((a) => a.allergenId === allergenId);
      if (existing) {
        return prev.filter((a) => a.allergenId !== allergenId);
      }
      return [...prev, { allergenId, note: `ALLERGY: No ${allergenName}` }];
    });
  };

  // Calculate total price
  const variantAdjustment =
    product.variants?.find((v) => v.id === selectedVariant)?.priceAdjustment || 0;

  let modifiersTotal = 0;
  Object.entries(selectedModifiers).forEach(([groupId, modIds]) => {
    const group = product.modifierGroups?.find((g) => g.id === groupId);
    modIds.forEach((modId) => {
      const mod = group?.modifiers.find((m) => m.id === modId);
      if (mod) modifiersTotal += mod.price;
    });
  });

  const unitPrice = (Number(product.basePrice) || 0) + (Number(variantAdjustment) || 0) + (Number(modifiersTotal) || 0);
  const totalPrice = unitPrice * (Number(quantity) || 0);

  // Validate required modifiers
  const isValid = () => {
    return (
      product.modifierGroups?.every((group) => {
        if (!group.isRequired) return true;
        const selected = selectedModifiers[group.id]?.length || 0;
        return selected >= group.minSelect;
      }) ?? true
    );
  };

  const handleAddToCart = () => {
    const modifiers: { modifierId: string; quantity: number }[] = [];
    Object.values(selectedModifiers).flat().forEach((modId) => {
      modifiers.push({ modifierId: modId, quantity: 1 });
    });

    onAddToCart({
      productId: product.id,
      variantId: selectedVariant || undefined,
      quantity,
      modifiers,
      specialInstructions: specialInstructions || undefined,
      allergyNotes: allergyNotes.length > 0 ? allergyNotes : undefined,
    });

    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" title={product.name}>
      <div className="space-y-6">
        {/* Product Image */}
        {product.imageUrl && (
          <div className="aspect-video rounded-xl overflow-hidden bg-gray-100">
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-full object-cover"
            />
          </div>
        )}

        {/* Description */}
        {product.description && (
          <p className="text-gray-600">{product.description}</p>
        )}

        {/* Allergen Warnings */}
        {product.allergens && product.allergens.length > 0 && (
          <div className="p-4 bg-amber-50 rounded-xl border border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <Icon icon="solar:danger-triangle-bold" className="w-5 h-5 text-amber-600" />
              <span className="font-semibold text-amber-800">Contains Allergens</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {product.allergens.map((allergen) => (
                <button
                  key={allergen.id}
                  onClick={() => handleAllergyToggle(allergen.id, allergen.name)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                    allergyNotes.some((a) => a.allergenId === allergen.id)
                      ? "bg-red-600 text-white"
                      : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                  }`}
                >
                  {allergen.icon} {allergen.name}
                  {allergyNotes.some((a) => a.allergenId === allergen.id) && (
                    <span className="ml-1">✗</span>
                  )}
                </button>
              ))}
            </div>
            <p className="text-xs text-amber-600 mt-2">
              Tap an allergen to mark as customer allergy
            </p>
          </div>
        )}

        {/* Variants */}
        {product.variants && product.variants.length > 0 && (
          <div>
            <h4 className="font-semibold text-gray-900 mb-3">Choose Size</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {product.variants.map((variant) => (
                <button
                  key={variant.id}
                  onClick={() => setSelectedVariant(variant.id)}
                  className={`p-3 rounded-xl border-2 transition-all ${
                    selectedVariant === variant.id
                      ? "border-teal-500 bg-teal-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <span className="block font-medium text-gray-900">{variant.name}</span>
                  {variant.priceAdjustment !== 0 && (
                    <span className="text-sm text-gray-500">
                      {variant.priceAdjustment > 0 ? "+" : ""}
                      {formatPrice(variant.priceAdjustment)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Modifier Groups */}
        {product.modifierGroups?.map((group) => (
          <div key={group.id}>
            <div className="flex items-center gap-2 mb-3">
              <h4 className="font-semibold text-gray-900">{group.displayName}</h4>
              {group.isRequired && (
                <Badge variant="danger" size="sm">
                  Required
                </Badge>
              )}
              {group.maxSelect > 1 && (
                <span className="text-sm text-gray-500">
                  (Select up to {group.maxSelect})
                </span>
              )}
            </div>
            <div className="space-y-2">
              {group.modifiers.map((modifier) => {
                const isSelected = selectedModifiers[group.id]?.includes(modifier.id);
                return (
                  <button
                    key={modifier.id}
                    onClick={() =>
                      handleModifierToggle(group.id, modifier.id, group.maxSelect)
                    }
                    className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition-all ${
                      isSelected
                        ? "border-teal-500 bg-teal-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                          isSelected
                            ? "border-teal-500 bg-teal-500"
                            : "border-gray-300"
                        }`}
                      >
                        {isSelected && (
                          <Icon icon="solar:check-bold" className="w-3 h-3 text-white" />
                        )}
                      </div>
                      <span className="font-medium text-gray-900">{modifier.name}</span>
                    </div>
                    {modifier.price > 0 && (
                      <span className="text-gray-500">+{formatPrice(modifier.price)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {/* Special Instructions */}
        <div>
          <h4 className="font-semibold text-gray-900 mb-3">Special Instructions</h4>
          <textarea
            value={specialInstructions}
            onChange={(e) => setSpecialInstructions(e.target.value)}
            placeholder="Any special requests? (e.g., extra sauce, less spicy)"
            className="input min-h-[80px] resize-none"
          />
        </div>

        {/* Quantity & Add to Cart */}
        <div className="flex items-center gap-4 pt-4 border-t border-gray-200">
          <div className="flex items-center gap-3 bg-gray-100 rounded-xl p-1">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="w-10 h-10 rounded-lg bg-white hover:bg-gray-50 flex items-center justify-center shadow-sm"
            >
              <Icon icon="solar:minus-linear" className="w-5 h-5 text-gray-600" />
            </button>
            <span className="w-8 text-center font-bold text-lg">{quantity}</span>
            <button
              onClick={() => setQuantity(quantity + 1)}
              className="w-10 h-10 rounded-lg bg-white hover:bg-gray-50 flex items-center justify-center shadow-sm"
            >
              <Icon icon="solar:add-linear" className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          <Button
            onClick={handleAddToCart}
            disabled={!isValid()}
            fullWidth
            size="xl"
          >
            Add to Order • {formatPrice(totalPrice)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
