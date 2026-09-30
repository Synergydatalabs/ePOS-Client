"use client";

// Add / edit modal for a single supplier product. Handles image upload
// (base64 inline, same pattern as merchant product images), all field
// validation client-side (backend re-validates), and communicates the
// resulting product back up via onSaved so the parent list can refresh
// without a full round-trip.

import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import { Modal, Button, Input, Select, Toggle } from "@/components/ui";
import VariantsEditor, {
  type VariantsEditorState,
  type VariantForApi,
} from "./VariantsEditor";
import TierEditor, { type PriceTierValue } from "./TierEditor";

interface Category {
  id: string;
  name: string;
}

export interface ProductImage {
  id?: string;
  dataUrl: string;
  altText?: string | null;
  sortOrder?: number;
  isPrimary?: boolean;
}

export interface EditableProduct {
  id?: string;
  sku?: string | null;
  barcode?: string | null;
  name: string;
  description?: string | null;
  unitLabel?: string;
  categoryId?: string | null;
  wholesalePriceCents?: number;
  retailPriceCents?: number | null;
  minOrderQty?: number;
  stepQty?: number;
  trackInventory?: boolean;
  stockLevel?: number | null;
  lowStockThreshold?: number | null;
  leadTimeDays?: number | null;
  isPublic?: boolean;
  isActive?: boolean;
  images?: ProductImage[];
}

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 1 * 1024 * 1024; // 1 MB source file (base64 inflates ~33%)

interface Props {
  isOpen: boolean;
  onClose: () => void;
  product: EditableProduct | null; // null = new product
  categories: Category[];
  currency: string;
  onSaved: () => void;
}

export default function ProductModal({
  isOpen,
  onClose,
  product,
  categories,
  currency,
  onSaved,
}: Props) {
  const isEdit = !!product?.id;
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Everything is controlled — one state object per field. Verbose but
  // predictable, and matches how the merchant Product modal works.
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [barcode, setBarcode] = useState("");
  const [description, setDescription] = useState("");
  const [unitLabel, setUnitLabel] = useState("unit");
  const [categoryId, setCategoryId] = useState<string>("");
  const [wholesalePrice, setWholesalePrice] = useState<string>("");
  const [retailPrice, setRetailPrice] = useState<string>("");
  // Phase H #1 (2026-09-02): per-product currency override — vendors
  // that price globally (Mego licence in USD, an AI model in EUR)
  // pin the currency here so every invoice using this product picks
  // up the right currency automatically.
  const [priceCurrency, setPriceCurrency] = useState<string>(currency);
  const [minOrderQty, setMinOrderQty] = useState<string>("1");
  const [stepQty, setStepQty] = useState<string>("1");
  const [trackInventory, setTrackInventory] = useState(false);
  const [stockLevel, setStockLevel] = useState<string>("");
  const [lowStockThreshold, setLowStockThreshold] = useState<string>("");
  const [leadTimeDays, setLeadTimeDays] = useState<string>("");
  const [isPublic, setIsPublic] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [images, setImages] = useState<ProductImage[]>([]);

  // Phase D #71: variant state. VariantsEditor is the source of truth for
  // both `variantAxes` and the full `variants[]` payload we send at save.
  const [variantState, setVariantState] = useState<VariantsEditorState>({
    variantAxes: [],
    variants: [],
  });
  // Seed values for VariantsEditor — refreshed when the modal loads a
  // product for edit. Also lets "New product" always render an empty editor.
  const [variantSeed, setVariantSeed] = useState<{
    axes: string[];
    variants: VariantForApi[];
  }>({ axes: [], variants: [] });

  // Phase D #73: product-level tiers (used only when the product has no
  // variants — enforced server-side too). Empty by default; loaded from
  // the product on edit.
  const [productTiers, setProductTiers] = useState<PriceTierValue[]>([]);

  // Phase F #1 (2026-08-27): software-listing state. `productType` gates the
  // whole "Software details" section — when it's PHYSICAL these values are
  // untouched and get stripped server-side. When SOFTWARE, physical-only
  // fields (SKU, stock, min-order-qty, lead time) stay in the UI but read
  // "Not applicable to software" and default sensibly.
  const [productType, setProductType] = useState<"PHYSICAL" | "SOFTWARE">("PHYSICAL");
  const [softwareDownloadUrl, setSoftwareDownloadUrl] = useState("");
  const [softwareDocsUrl, setSoftwareDocsUrl] = useState("");
  const [softwareVersion, setSoftwareVersion] = useState("");
  const [softwareRequirements, setSoftwareRequirements] = useState("");
  const [softwareLicenseModel, setSoftwareLicenseModel] = useState("");
  const [softwarePricingModel, setSoftwarePricingModel] = useState<
    "ONE_TIME" | "MONTHLY" | "ANNUAL" | "USAGE"
  >("ONE_TIME");
  const [softwareTrialDays, setSoftwareTrialDays] = useState("");

  // Phase F #6q + #6r (2026-08-29): per-product T&C + vendor identity for
  // the reseller marketplace. Only surfaced when productType === 'SOFTWARE'.
  const [termsVersionId, setTermsVersionId] = useState("");
  const [availableTerms, setAvailableTerms] = useState<
    Array<{ id: string; version: string; effectiveFrom: string | null; effectiveTo: string | null }>
  >([]);
  const [vendorName, setVendorName] = useState("");
  const [vendorLogoUrl, setVendorLogoUrl] = useState("");
  const [vendorWebsiteUrl, setVendorWebsiteUrl] = useState("");
  const [vendorSupportEmail, setVendorSupportEmail] = useState("");
  // #6s: vendor brand color (hex). When set, the pay page swaps its palette
  // to this vendor's brand for buyers of this product.
  const [vendorBrandColor, setVendorBrandColor] = useState("");
  // #6t: compliance text — shown in the pixel-perfect vendor pay page.
  const [vendorLegalName, setVendorLegalName] = useState("");
  const [vendorLicenseText, setVendorLicenseText] = useState("");
  const [vendorStatementDescriptor, setVendorStatementDescriptor] = useState("");

  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Reset (or pre-fill) whenever the modal opens with a new subject.
  useEffect(() => {
    if (!isOpen) return;

    if (!isEdit) {
      setName("");
      setSku("");
      setBarcode("");
      setDescription("");
      setUnitLabel("unit");
      setCategoryId("");
      setWholesalePrice("");
      setRetailPrice("");
      setPriceCurrency(currency);
      setMinOrderQty("1");
      setStepQty("1");
      setTrackInventory(false);
      setStockLevel("");
      setLowStockThreshold("");
      setLeadTimeDays("");
      setIsPublic(false);
      setIsActive(true);
      setImages([]);
      // Fresh product = no variants; editor renders empty state.
      setVariantSeed({ axes: [], variants: [] });
      setVariantState({ variantAxes: [], variants: [] });
      // Fresh product = no tiers.
      setProductTiers([]);
      // Phase F #1: default new products to PHYSICAL. Supplier switches
      // via the toggle at the top of the form.
      setProductType("PHYSICAL");
      setSoftwareDownloadUrl("");
      setSoftwareDocsUrl("");
      setSoftwareVersion("");
      setSoftwareRequirements("");
      setSoftwareLicenseModel("");
      setSoftwarePricingModel("ONE_TIME");
      setSoftwareTrialDays("");
      setTermsVersionId("");
      setVendorName("");
      setVendorLogoUrl("");
      setVendorWebsiteUrl("");
      setVendorSupportEmail("");
      setVendorBrandColor("");
      setVendorLegalName("");
      setVendorLicenseText("");
      setVendorStatementDescriptor("");
      return;
    }

    // Editing an existing product: the parent passed us a summary row (list
    // view didn't include full image data), so fetch the full record here.
    setLoadingDetail(true);
    fetch(`/api/supplier/products/${product!.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (!data.success) {
          toast.error(data.error || "Failed to load product");
          return;
        }
        const p = data.product;
        setName(p.name || "");
        setSku(p.sku || "");
        setBarcode(p.barcode || "");
        setDescription(p.description || "");
        setUnitLabel(p.unitLabel || "unit");
        setCategoryId(p.categoryId || "");
        setWholesalePrice((p.wholesalePriceCents / 100).toFixed(2));
        setPriceCurrency(p.priceCurrency || currency);
        setRetailPrice(
          p.retailPriceCents != null ? (p.retailPriceCents / 100).toFixed(2) : ""
        );
        setMinOrderQty(String(p.minOrderQty));
        setStepQty(String(p.stepQty));
        setTrackInventory(Boolean(p.trackInventory));
        setStockLevel(p.stockLevel != null ? String(p.stockLevel) : "");
        setLowStockThreshold(
          p.lowStockThreshold != null ? String(p.lowStockThreshold) : ""
        );
        setLeadTimeDays(p.leadTimeDays != null ? String(p.leadTimeDays) : "");
        setIsPublic(Boolean(p.isPublic));
        setIsActive(Boolean(p.isActive));
        setImages(
          (p.images || []).map((img: any) => ({
            id: img.id,
            dataUrl: img.dataUrl,
            altText: img.altText,
            sortOrder: img.sortOrder,
            isPrimary: img.isPrimary,
          }))
        );
        // Phase D #71: seed the variants editor with server data.
        // Phase D #73: pull in each variant's priceTiers array.
        const seedVariants: VariantForApi[] = (p.variants || []).map((v: any) => ({
          id: v.id,
          displayName: v.displayName,
          attributes: v.attributes ?? {},
          sku: v.sku ?? null,
          barcode: v.barcode ?? null,
          wholesalePriceCents: v.wholesalePriceCents ?? null,
          retailPriceCents: v.retailPriceCents ?? null,
          minOrderQty: v.minOrderQty ?? null,
          stepQty: v.stepQty ?? null,
          trackInventory: !!v.trackInventory,
          stockLevel: v.stockLevel ?? null,
          lowStockThreshold: v.lowStockThreshold ?? null,
          imageDataUrl: v.imageDataUrl ?? null,
          isActive: v.isActive !== false,
          sortOrder: v.sortOrder ?? 0,
          priceTiers: Array.isArray(v.priceTiers)
            ? v.priceTiers.map((t: any) => ({
                minQty: t.minQty,
                unitPriceCents: t.unitPriceCents,
              }))
            : [],
        }));
        setVariantSeed({
          axes: Array.isArray(p.variantAxes) ? p.variantAxes : [],
          variants: seedVariants,
        });
        setVariantState({
          variantAxes: Array.isArray(p.variantAxes) ? p.variantAxes : [],
          variants: seedVariants,
        });
        // Phase D #73: product-level tiers (only present on simple products).
        setProductTiers(
          Array.isArray(p.priceTiers)
            ? p.priceTiers.map((t: any) => ({
                minQty: t.minQty,
                unitPriceCents: t.unitPriceCents,
              }))
            : []
        );
        // Phase F #1 (2026-08-27): software-listing fields. Anything the
        // server didn't send falls back to defaults; anything other than
        // 'SOFTWARE' for productType is treated as PHYSICAL so a stale
        // enum value never leaves the form in an ambiguous state.
        setProductType(p.productType === "SOFTWARE" ? "SOFTWARE" : "PHYSICAL");
        setSoftwareDownloadUrl(p.softwareDownloadUrl || "");
        setSoftwareDocsUrl(p.softwareDocsUrl || "");
        setSoftwareVersion(p.softwareVersion || "");
        setSoftwareRequirements(p.softwareRequirements || "");
        setSoftwareLicenseModel(p.softwareLicenseModel || "");
        setSoftwarePricingModel(
          ["ONE_TIME", "MONTHLY", "ANNUAL", "USAGE"].includes(p.softwarePricingModel)
            ? p.softwarePricingModel
            : "ONE_TIME"
        );
        setSoftwareTrialDays(
          p.softwareTrialDays != null ? String(p.softwareTrialDays) : ""
        );
        // Phase F #6q + #6r (2026-08-29): T&C + vendor prefill.
        setTermsVersionId(p.termsVersionId || "");
        setVendorName(p.vendorName || "");
        setVendorLogoUrl(p.vendorLogoUrl || "");
        setVendorWebsiteUrl(p.vendorWebsiteUrl || "");
        setVendorSupportEmail(p.vendorSupportEmail || "");
        setVendorBrandColor(p.vendorBrandColor || "");
        setVendorLegalName(p.vendorLegalName || "");
        setVendorLicenseText(p.vendorLicenseText || "");
        setVendorStatementDescriptor(p.vendorStatementDescriptor || "");
      })
      .catch(() => toast.error("Failed to load product"))
      .finally(() => setLoadingDetail(false));
  }, [isOpen, isEdit, product]);

  // Phase F #6q (2026-08-29): lazy-load the supplier's published T&C versions
  // so the software section's dropdown has real options. Cheap (~1 query) and
  // only fired when the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/supplier/terms")
      .then((r) => r.json())
      .then((data) => {
        if (data.success && Array.isArray(data.versions)) {
          // Phase H #2 (2026-09-02): only surface the LATEST version
          // per brand family in the picker — a family is the substring
          // before the first "-" in the version label (e.g. "megopay-
          // 2026-08-30.1" and "mymego-2026-08-30.1" are separate
          // families). This prevents accidentally picking a retired
          // brand's T&C on a new product (Mego rebrand from MegoPay).
          const versions = data.versions as Array<{
            id: string; version: string;
            effectiveFrom: string | null; effectiveTo: string | null;
          }>;
          const byFamily = new Map<string, typeof versions[number]>();
          for (const v of versions) {
            const family = (v.version.split("-")[0] || v.version).toLowerCase();
            const current = byFamily.get(family);
            if (!current) { byFamily.set(family, v); continue; }
            // Prefer the row with the most recent effectiveFrom; fall
            // back to lexicographic version compare so labels like
            // "mymego-2026-08-30.2" beat ".1" when effectiveFrom ties.
            const a = v.effectiveFrom ? Date.parse(v.effectiveFrom) : 0;
            const b = current.effectiveFrom ? Date.parse(current.effectiveFrom) : 0;
            if (a > b || (a === b && v.version.localeCompare(current.version) > 0)) {
              byFamily.set(family, v);
            }
          }
          setAvailableTerms(Array.from(byFamily.values()));
        }
      })
      .catch(() => { /* silent — the dropdown just shows "No T&C published yet" */ });
  }, [isOpen]);

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    if (images.length + files.length > MAX_IMAGES) {
      toast.error(`Up to ${MAX_IMAGES} images per product`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const newImages: ProductImage[] = [];
    for (const file of files) {
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`"${file.name}" is larger than 1 MB — skipped`);
        continue;
      }
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("File read failed"));
          reader.readAsDataURL(file);
        });
        newImages.push({
          dataUrl,
          altText: null,
          sortOrder: images.length + newImages.length,
          // Mark as primary only if this will be the first image on the product.
          isPrimary: images.length + newImages.length === 0,
        });
      } catch {
        toast.error(`Failed to read "${file.name}"`);
      }
    }

    setImages([...images, ...newImages]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeImage = (idx: number) => {
    const next = images.filter((_, i) => i !== idx);
    // If we removed the primary, promote the first remaining image so the
    // product always has one primary (backend enforces this too).
    const anyPrimary = next.some((i) => i.isPrimary);
    if (!anyPrimary && next.length) next[0].isPrimary = true;
    setImages(next);
  };

  const setPrimary = (idx: number) => {
    setImages(images.map((img, i) => ({ ...img, isPrimary: i === idx })));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Product name is required");
      return;
    }
    const wholesaleCents = Math.round(parseFloat(wholesalePrice || "0") * 100);
    if (!Number.isFinite(wholesaleCents) || wholesaleCents < 0) {
      toast.error("Enter a valid wholesale price");
      return;
    }
    const retailCents =
      retailPrice.trim() === ""
        ? null
        : Math.round(parseFloat(retailPrice) * 100);
    if (retailCents != null && (!Number.isFinite(retailCents) || retailCents < 0)) {
      toast.error("Retail price must be a valid number or blank");
      return;
    }

    const payload = {
      name: name.trim(),
      sku: sku.trim() || null,
      barcode: barcode.trim() || null,
      description: description.trim() || null,
      unitLabel: unitLabel.trim() || "unit",
      categoryId: categoryId || null,
      wholesalePriceCents: wholesaleCents,
      retailPriceCents: retailCents,
      priceCurrency: (priceCurrency || currency).toUpperCase().slice(0, 3),
      minOrderQty: Math.max(1, parseInt(minOrderQty || "1", 10)),
      stepQty: Math.max(1, parseInt(stepQty || "1", 10)),
      trackInventory,
      stockLevel: trackInventory && stockLevel !== "" ? parseInt(stockLevel, 10) : null,
      lowStockThreshold:
        trackInventory && lowStockThreshold !== ""
          ? parseInt(lowStockThreshold, 10)
          : null,
      leadTimeDays: leadTimeDays !== "" ? parseInt(leadTimeDays, 10) : null,
      isPublic,
      isActive,
      images: images.map((img, i) => ({
        dataUrl: img.dataUrl,
        altText: img.altText,
        sortOrder: i,
        isPrimary: !!img.isPrimary,
      })),
      // Phase D #71: variants — VariantsEditor kept `variantState` in sync
      // as the supplier edited. Empty axes = simple product (variants: []).
      variantAxes: variantState.variantAxes,
      variants: variantState.variants,
      // Phase D #73: product-level tiers only when the product is simple.
      // Server rejects tiers on a product with variants (guard rail) — the
      // condition here mirrors that so a stale editor state doesn't 400.
      priceTiers:
        variantState.variantAxes.length === 0 ? productTiers : [],
      // Phase F #1 (2026-08-27): productType + software fields. Server
      // still strips the software fields when productType==='PHYSICAL',
      // so it's safe to always include them.
      productType,
      softwareDownloadUrl: softwareDownloadUrl.trim() || null,
      softwareDocsUrl: softwareDocsUrl.trim() || null,
      softwareVersion: softwareVersion.trim() || null,
      softwareRequirements: softwareRequirements.trim() || null,
      softwareLicenseModel: softwareLicenseModel.trim() || null,
      softwarePricingModel,
      softwareTrialDays: softwareTrialDays.trim() === "" ? null : parseInt(softwareTrialDays, 10),
      // Phase F #6q + #6r (2026-08-29): per-product T&C + vendor identity.
      // Server ignores these on PHYSICAL rows so it's safe to always send.
      termsVersionId: termsVersionId || null,
      vendorName: vendorName.trim() || null,
      vendorLogoUrl: vendorLogoUrl.trim() || null,
      vendorWebsiteUrl: vendorWebsiteUrl.trim() || null,
      vendorSupportEmail: vendorSupportEmail.trim() || null,
      vendorBrandColor: vendorBrandColor.trim() || null,
      vendorLegalName: vendorLegalName.trim() || null,
      vendorLicenseText: vendorLicenseText.trim() || null,
      vendorStatementDescriptor: vendorStatementDescriptor.trim() || null,
    };

    setSaving(true);
    try {
      const url = isEdit
        ? `/api/supplier/products/${product!.id}`
        : "/api/supplier/products";
      const res = await fetch(url, {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to save product");
        setSaving(false);
        return;
      }
      toast.success(isEdit ? "Product updated" : "Product created");
      onSaved();
      onClose();
    } catch {
      toast.error("Failed to save product");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEdit ? "Edit Product" : "Add Product"}
      size="lg"
    >
      {loadingDetail ? (
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-gray-100 rounded-lg" />
          <div className="h-24 bg-gray-100 rounded-lg" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-10 bg-gray-100 rounded-lg" />
            <div className="h-10 bg-gray-100 rounded-lg" />
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Phase F #1 (2026-08-27): product-type segmented control.
              Physical vs Software listing. The choice reshapes what fields
              matter below — hides physical-only fields when SOFTWARE, and
              adds a "Software details" section further down. The current
              choice reads as a pill next to the label so it's obvious at
              a glance which mode the supplier is in. */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
              Product type
            </label>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1" role="tablist">
              {(["PHYSICAL", "SOFTWARE"] as const).map((t) => {
                const active = productType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setProductType(t)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      active
                        ? "bg-white text-teal-700 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {t === "PHYSICAL" ? "Physical goods" : "Software listing"}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {productType === "SOFTWARE"
                ? "Software listings hide stock, SKU, and shipping fields. Add a download URL, licence model, and pricing model below."
                : "Physical goods use SKU, stock, min-order quantity, and shipping lead time."}
            </p>
          </div>

          {/* Basics */}
          <div>
            <Input
              label="Product name"
              placeholder={productType === "SOFTWARE"
                ? "e.g. hub POS, Restaurant Edition"
                : "e.g. Mozzarella Cheese, 20kg Box"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="SKU (optional)"
              placeholder="e.g. MOZ-20KG"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              helperText="Unique per your catalog"
            />
            <Input
              label="Barcode (optional)"
              placeholder="UPC / EAN"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
            />
            <Select
              label="Category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              options={[
                { value: "", label: "— Uncategorized —" },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Description
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={productType === "SOFTWARE"
                ? "What does this software do? Who is it for?"
                : "Anything a merchant should know before ordering."}
              className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
          </div>

          {/* Phase F #1 (2026-08-27): Software-listing details.
              Only rendered for productType === 'SOFTWARE'. The stack:
                • Version + Trial (short row)
                • License model + Pricing model (short row)
                • Download URL + Docs URL (short row)
                • System requirements (textarea)
              Teal accent to match the hub brand — the section is the
              feature that makes hub a marketplace, so it gets a distinct
              tinted card instead of blending into the physical-goods form. */}
          {productType === "SOFTWARE" && (
            <div className="p-4 rounded-2xl bg-teal-50/60 border border-teal-100">
              <h4 className="text-sm font-semibold text-teal-800 mb-3">
                Software details
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Version (optional)"
                  placeholder="e.g. 1.2.0, 2026.08, beta-4"
                  value={softwareVersion}
                  onChange={(e) => setSoftwareVersion(e.target.value)}
                  helperText="Whatever version string you use"
                />
                <Input
                  label="Trial period (days, optional)"
                  type="number"
                  min={0}
                  step={1}
                  placeholder="e.g. 14"
                  value={softwareTrialDays}
                  onChange={(e) => setSoftwareTrialDays(e.target.value)}
                  helperText="Leave blank for no trial"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <Input
                  label="Licence model (optional)"
                  placeholder="e.g. Per seat, Per install, Perpetual"
                  value={softwareLicenseModel}
                  onChange={(e) => setSoftwareLicenseModel(e.target.value)}
                />
                <Select
                  label="Pricing model"
                  value={softwarePricingModel}
                  onChange={(e) =>
                    setSoftwarePricingModel(e.target.value as typeof softwarePricingModel)
                  }
                  options={[
                    { value: "ONE_TIME", label: "One-time payment" },
                    { value: "MONTHLY",  label: "Monthly subscription" },
                    { value: "ANNUAL",   label: "Annual subscription" },
                    { value: "USAGE",    label: "Usage-based" },
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <Input
                  label="Download URL"
                  placeholder="https://…"
                  value={softwareDownloadUrl}
                  onChange={(e) => setSoftwareDownloadUrl(e.target.value)}
                  helperText="Where buyers download the installer / package"
                />
                <Input
                  label="Documentation URL (optional)"
                  placeholder="https://docs.example.com"
                  value={softwareDocsUrl}
                  onChange={(e) => setSoftwareDocsUrl(e.target.value)}
                />
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  System requirements (optional)
                </label>
                <textarea
                  rows={3}
                  value={softwareRequirements}
                  onChange={(e) => setSoftwareRequirements(e.target.value)}
                  placeholder={"e.g.\nWindows 10 or later\n4 GB RAM\n500 MB disk"}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-transparent outline-none font-mono text-sm"
                />
              </div>

              {/* Phase F #6r (2026-08-29): vendor identity — for reseller
                  marketplace pattern. Shown on the pay page as "Sold by hub
                  — {vendorName}" so the buyer sees who made the software
                  even though hub is the merchant of record. */}
              <div className="mt-4 pt-4 border-t border-teal-100">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Vendor identity <span className="normal-case font-normal text-gray-400">(optional — for resold products)</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Vendor name"
                    placeholder="e.g. MegoPay"
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    helperText="Shown as “Sold by hub — {Vendor}”"
                  />
                  <Input
                    label="Vendor logo URL"
                    placeholder="/images/logo/mego-pay-logo.png"
                    value={vendorLogoUrl}
                    onChange={(e) => setVendorLogoUrl(e.target.value)}
                    helperText="Shown on the pay page (512x512 recommended)"
                  />
                  <Input
                    label="Vendor website"
                    placeholder="https://rbpfinivis.com"
                    value={vendorWebsiteUrl}
                    onChange={(e) => setVendorWebsiteUrl(e.target.value)}
                  />
                  <Input
                    label="Vendor support email"
                    type="email"
                    placeholder="support@rbpfinivis.com"
                    value={vendorSupportEmail}
                    onChange={(e) => setVendorSupportEmail(e.target.value)}
                    helperText="Where product-support goes (not payments)"
                  />
                </div>
                {/* #6s: brand color — drives the per-vendor pay-page theme swap.
                    Sits under the identity fields with a native color picker so
                    the supplier can eyedrop the vendor's hex without leaving
                    the modal. */}
                <div className="mt-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    Vendor brand color <span className="text-xs text-gray-400 font-normal">(optional — powers the pay-page theme)</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={vendorBrandColor || "#006AFF"}
                      onChange={(e) => setVendorBrandColor(e.target.value.toUpperCase())}
                      className="h-10 w-14 rounded-lg border border-gray-200 cursor-pointer bg-white"
                      aria-label="Vendor brand color picker"
                    />
                    <input
                      type="text"
                      value={vendorBrandColor}
                      onChange={(e) => setVendorBrandColor(e.target.value.toUpperCase())}
                      placeholder="#006AFF"
                      maxLength={7}
                      className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono uppercase"
                    />
                    {vendorBrandColor ? (
                      <button
                        type="button"
                        onClick={() => setVendorBrandColor("")}
                        className="text-xs text-gray-500 underline"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    When set, the pay page uses this color for the hero, buttons, and accents on this product's invoices.
                  </p>
                </div>
                {/* #6t: compliance text — parent legal name, licence text,
                    statement descriptor. Rendered verbatim on the vendor
                    pay page's footer / statement-notice. */}
                <div className="mt-4 pt-4 border-t border-teal-100/70">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Vendor compliance <span className="normal-case font-normal text-gray-400">(shown in pay-page footer)</span>
                  </p>
                  <div className="grid grid-cols-1 gap-3">
                    <Input
                      label="Vendor legal name"
                      placeholder="e.g. RBP FINIVIS Private Limited"
                      value={vendorLegalName}
                      onChange={(e) => setVendorLegalName(e.target.value)}
                      helperText="Parent company — shown in the pay-page footer endorsement"
                    />
                    <Input
                      label="License / regulator text"
                      placeholder="e.g. RBI Licence No. CHG. FFMC 0297/2023"
                      value={vendorLicenseText}
                      onChange={(e) => setVendorLicenseText(e.target.value)}
                      helperText="Regulator or licence line — shown in the footer"
                    />
                    <Input
                      label="Statement descriptor"
                      placeholder="e.g. MEGO PAY"
                      value={vendorStatementDescriptor}
                      onChange={(e) => setVendorStatementDescriptor(e.target.value.toUpperCase())}
                      maxLength={64}
                      helperText="How the charge appears on the buyer's card statement (shown before Pay so buyers don't dispute an unfamiliar name)"
                    />
                  </div>
                </div>
              </div>

              {/* Phase F #6q (2026-08-29): per-product T&C dropdown. Options
                  are the supplier tenant's published T&C versions. Leave
                  blank to fall back to the supplier's default T&C on the
                  pay page. */}
              <div className="mt-4 pt-4 border-t border-teal-100">
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Terms of Sale <span className="text-xs text-gray-400 font-normal">(optional — vendor-specific T&C)</span>
                </label>
                <select
                  value={termsVersionId}
                  onChange={(e) => setTermsVersionId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white"
                >
                  <option value="">— Use supplier default T&C —</option>
                  {availableTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.version}
                      {t.effectiveTo == null ? " (active)" : ""}
                    </option>
                  ))}
                </select>
                {availableTerms.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    No T&C published yet. Publish one at{" "}
                    <a
                      href="/supplier/terms"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      /supplier/terms
                    </a>{" "}
                    first, then it will appear here.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-gray-500">
                    Customer sees + must accept THIS T&C at checkout when they buy this product.
                    Enables per-vendor terms on a reseller marketplace.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Pricing + unit */}
          <div className="p-4 rounded-2xl bg-indigo-50/50 border border-indigo-100">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">
              Pricing & Unit
            </h4>
            {/* Phase H #5 (2026-09-02): per-product currency picker removed.
                The vendor sets a tenant-level default currency on the
                supplier settings page instead — every product uses that
                default, and invoices auto-fill to it. The DB column
                `price_currency` stays on the row (defaults to tenant
                currency at create time) so nothing has to migrate to
                bring the picker back later. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Input
                label={`Wholesale price (${currency})`}
                type="number"
                min={0}
                step="0.01"
                value={wholesalePrice}
                onChange={(e) => setWholesalePrice(e.target.value)}
                required
                helperText="What the merchant pays"
              />
              <Input
                label={`Retail price (${currency}, optional)`}
                type="number"
                min={0}
                step="0.01"
                value={retailPrice}
                onChange={(e) => setRetailPrice(e.target.value)}
                helperText="MSRP shown as reference"
              />
              <Input
                label="Unit label"
                placeholder="e.g. box, case, kg"
                value={unitLabel}
                onChange={(e) => setUnitLabel(e.target.value)}
                helperText='Shown in cart ("per box")'
              />
            </div>

            {/* Phase D #73: product-level volume tiers. Rendered inline
                under the pricing section because that's semantically where
                pricing controls live. Only shown when the product has no
                variants — otherwise tiers hang off each variant instead
                (see VariantsEditor). Server enforces the same rule. */}
            {variantState.variantAxes.length === 0 && (
              <div className="mt-4">
                <TierEditor
                  value={productTiers}
                  currency={currency}
                  basePriceCents={
                    wholesalePrice
                      ? Math.round(parseFloat(wholesalePrice) * 100)
                      : null
                  }
                  onChange={setProductTiers}
                />
              </div>
            )}
          </div>

          {/* Order rules */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Min order qty"
              type="number"
              min={1}
              value={minOrderQty}
              onChange={(e) => setMinOrderQty(e.target.value)}
              helperText="Smallest order"
            />
            <Input
              label="Order in multiples of"
              type="number"
              min={1}
              value={stepQty}
              onChange={(e) => setStepQty(e.target.value)}
              helperText="e.g. 6 = order 6, 12, 18…"
            />
            <Input
              label="Lead time (days)"
              type="number"
              min={0}
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(e.target.value)}
              helperText="Overrides profile default"
            />
          </div>

          {/* Inventory toggle + fields */}
          <div className="p-4 rounded-2xl border border-gray-200">
            <Toggle
              label="Track inventory"
              description="Show live stock levels to merchants + get low-stock alerts"
              checked={trackInventory}
              onChange={setTrackInventory}
            />
            {trackInventory && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <Input
                  label="Current stock"
                  type="number"
                  min={0}
                  value={stockLevel}
                  onChange={(e) => setStockLevel(e.target.value)}
                />
                <Input
                  label="Low-stock alert at"
                  type="number"
                  min={0}
                  value={lowStockThreshold}
                  onChange={(e) => setLowStockThreshold(e.target.value)}
                  helperText="Get notified when stock drops below this"
                />
              </div>
            )}
          </div>

          {/* Phase D #71: Variants editor — arbitrary axes, auto-generated
              grid. Empty state = simple product, no variants. Server
              validates on save and soft-deletes retired combinations. */}
          <VariantsEditor
            currency={currency}
            initialAxes={variantSeed.axes}
            initialVariants={variantSeed.variants}
            onChange={setVariantState}
          />

          {/* Images */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-gray-900">
                Images
                <span className="text-xs font-normal text-gray-500 ml-2">
                  {images.length} / {MAX_IMAGES} · under 1 MB each
                </span>
              </label>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={images.length >= MAX_IMAGES}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100 disabled:opacity-40"
              >
                <Icon icon="solar:upload-linear" className="w-3.5 h-3.5" />
                Add Image
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                onChange={handleFilePick}
              />
            </div>
            {images.length === 0 ? (
              <div className="p-6 border-2 border-dashed border-gray-200 rounded-xl text-center text-sm text-gray-500">
                No images yet. Add up to {MAX_IMAGES}.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {images.map((img, idx) => (
                  <div
                    key={idx}
                    className={`relative rounded-xl overflow-hidden border-2 ${
                      img.isPrimary ? "border-indigo-500" : "border-gray-100"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.dataUrl}
                      alt={img.altText || `Image ${idx + 1}`}
                      className="w-full aspect-square object-cover bg-gray-50"
                    />
                    <div className="absolute top-1.5 left-1.5">
                      {img.isPrimary ? (
                        <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-semibold">
                          PRIMARY
                        </span>
                      ) : (
                        <button
                          onClick={() => setPrimary(idx)}
                          className="px-1.5 py-0.5 rounded bg-white/90 text-gray-700 text-[10px] font-medium hover:bg-white"
                        >
                          Set primary
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => removeImage(idx)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/90 text-red-500 hover:bg-white flex items-center justify-center"
                      title="Remove"
                    >
                      <Icon icon="solar:trash-bin-trash-linear" className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Visibility */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-4 rounded-2xl border border-gray-200">
              <Toggle
                label="Public in marketplace"
                description="Any merchant on iTap POS can find this product (only takes effect once your profile is also public)"
                checked={isPublic}
                onChange={setIsPublic}
              />
            </div>
            <div className="p-4 rounded-2xl border border-gray-200">
              <Toggle
                label="Available"
                description="Turn off to hide without deleting. Preserves order history."
                checked={isActive}
                onChange={setIsActive}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Product"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
