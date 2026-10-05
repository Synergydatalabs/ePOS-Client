// POST /api/tenants/[tenantId]/marketplace/suppliers/[supplierId]/orders
// Merchant submits a purchase order to one supplier.
//
// Body: {
//   locationId: string,          // merchant location shipping to
//   items: [{ productId, qty, notes? }],
//   notesToSupplier?: string,
// }
//
// Response: { success, purchaseOrder: { id, poNumber, ... } }
//
// Validation flow (fail fast, single trip):
//   1. Merchant has an ACTIVE relationship with this supplier
//   2. Location belongs to the merchant tenant
//   3. Every product exists, belongs to this supplier, and is active
//   4. Every qty ≥ product.minOrderQty AND (qty % product.stepQty) == 0
//   5. Subtotal ≥ supplier.minOrderCents (if set)
//   6. Cart isn't empty
//
// On success we insert PO + all line items in one transaction so a partial
// write is impossible. PO number is generated with a random 4-char suffix
// per supplier ("PO-2026-A7X3") — high uniqueness, and we retry up to 5
// times if a rare collision hits the unique index.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateRequest } from "@/lib/api-middleware";
import { notifyPoSubmitted } from "@/lib/marketplace-notify";
import { getProvider } from "@/lib/payment-providers";
import { kybDecryptJson } from "@/lib/kyb-crypto";
import { effectiveUnitPriceCents } from "@/lib/supplier-price-tiers";
import { generatePoNumberCandidate } from "@/lib/marketplace-po-number";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; supplierId: string }> }
) {
  try {
    const { tenantId, supplierId } = await params;

    // POS_STAFF is the least-privileged role that can place an order. If we
    // want to restrict PO creation to TENANT_ADMIN later, this is the
    // single line to change.
    const auth = await validateRequest(request, tenantId, "POS_STAFF");
    if (!auth.success) return auth.response;

    const body = await request.json();
    const locationId = String(body.locationId || "").trim();
    const notesToSupplier = body.notesToSupplier?.trim() || null;
    // Phase D #72 (2026-07-30): items now optionally carry variantId.
    // Legacy carts (no variant) stay valid — server picks the branch by
    // whether the referenced product has variantAxes.
    const rawItems: {
      productId: string;
      variantId?: string;
      qty: number;
      notes?: string;
    }[] = Array.isArray(body.items) ? body.items : [];

    if (!locationId) {
      return NextResponse.json({ error: "A delivery location is required" }, { status: 400 });
    }
    if (rawItems.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // (1) Relationship must be ACTIVE. Same guard as browse endpoints.
    const relationship = await prisma.supplierMerchantRelationship.findFirst({
      where: {
        merchantTenantId: tenantId,
        supplierTenantId: supplierId,
        status: "ACTIVE",
      },
      select: { id: true },
    });
    if (!relationship) {
      return NextResponse.json(
        { error: "You're not connected to this supplier" },
        { status: 403 }
      );
    }

    // (2) Location must belong to this merchant. Prevents a merchant from
    // shipping to another tenant's location via a leaked ID.
    const location = await prisma.location.findFirst({
      where: { id: locationId, tenantId, status: "ACTIVE" },
    });
    if (!location) {
      return NextResponse.json(
        { error: "Delivery location not found for this tenant" },
        { status: 404 }
      );
    }

    // (3) Load supplier tenant + profile (for currency + min-order) and
    // every product in the cart in ONE round-trip.
    const [supplierTenant, products] = await Promise.all([
      prisma.tenant.findFirst({
        where: { id: supplierId, businessType: "supplier" },
        select: {
          id: true,
          currency: true,
          supplierProfile: { select: { minOrderCents: true } },
        },
      }),
      prisma.supplierProduct.findMany({
        where: {
          supplierTenantId: supplierId,
          isActive: true,
          id: { in: rawItems.map((i) => i.productId) },
        },
        // Phase D #72: pull only the specific variants the cart references,
        // not the full variant catalog — cheaper query + smaller payload
        // for products with 50+ variants where only 1 is being ordered.
        // Phase D #73: nested tiers on both variant + product so we can
        // apply the best tier per line.
        include: {
          variants: {
            where: {
              isActive: true,
              id: {
                in: rawItems
                  .map((i) => i.variantId)
                  .filter((v): v is string => !!v),
              },
            },
            include: {
              priceTiers: {
                select: { minQty: true, unitPriceCents: true },
              },
            },
          },
          priceTiers: {
            select: { minQty: true, unitPriceCents: true },
          },
        },
      }),
    ]);

    if (!supplierTenant) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    const productById = new Map(products.map((p) => [p.id, p]));
    // Flat variant index for fast lookup — variants are nested per product
    // in `products`, but the validation loop treats each cart line
    // independently and doesn't want to walk the product's variant array.
    const variantById = new Map(
      products.flatMap((p) => p.variants.map((v) => [v.id, { product: p, variant: v }]))
    );

    // (4) Validate every line: product/variant still active, qty ≥
    // minOrderQty, qty a multiple of stepQty. Errors accumulate so the
    // merchant sees all problems at once.
    //
    // Variant resolution rules (Phase D #72):
    //   - Product with variantAxes populated MUST have a variantId — cart
    //     for that product without a variant is rejected as ambiguous.
    //   - Product with empty variantAxes MUST NOT have a variantId — a
    //     stale variantId from a product that lost its axes gets rejected.
    //   - Every effective field (price/min/step/stock) is variant-first
    //     with product-level fallback for null overrides.
    const lineErrors: { productId: string; message: string }[] = [];
    interface PreparedItem {
      product: (typeof products)[number];
      variant: (typeof products)[number]["variants"][number] | null;
      // Effective values after variant→product inheritance
      unitPriceCents: number;
      minOrderQty: number;
      stepQty: number;
      qty: number;
      notes: string | null;
    }
    const prepared: PreparedItem[] = [];

    for (const raw of rawItems) {
      const p = productById.get(raw.productId);
      if (!p) {
        lineErrors.push({
          productId: raw.productId,
          message: "Product no longer available",
        });
        continue;
      }

      const productHasVariants = (p.variantAxes || []).length > 0;
      let variant: (typeof products)[number]["variants"][number] | null = null;

      if (productHasVariants) {
        if (!raw.variantId) {
          lineErrors.push({
            productId: raw.productId,
            message: `"${p.name}" needs a specific variant — re-add from the storefront.`,
          });
          continue;
        }
        const found = variantById.get(raw.variantId);
        // Extra check: variant must belong to THIS product (defensive —
        // a leaked variantId shouldn't let a merchant attach it to a
        // different product's cart entry).
        if (!found || found.product.id !== p.id) {
          lineErrors.push({
            productId: raw.productId,
            message: `Selected variant no longer available for "${p.name}".`,
          });
          continue;
        }
        variant = found.variant;
      } else if (raw.variantId) {
        // Product used to have variants, supplier removed them. Stale cart.
        lineErrors.push({
          productId: raw.productId,
          message: `"${p.name}" no longer has variants — re-add from the storefront.`,
        });
        continue;
      }

      // Effective fields: variant overrides product where non-null.
      const basePrice = variant?.wholesalePriceCents ?? p.wholesalePriceCents;
      const effectiveMinQty = variant?.minOrderQty ?? p.minOrderQty;
      const effectiveStep = variant?.stepQty ?? p.stepQty;
      // Phase D #73: apply best volume tier. Variant tiers win when
      // there's a variant; otherwise product-level tiers. Falls through
      // to basePrice when no tier hits.
      const tiers = variant
        ? variant.priceTiers
        : p.variantAxes.length === 0
        ? p.priceTiers
        : [];
      // effectivePrice is only meaningful AFTER we know qty (which is
      // parsed below) — compute it after the qty checks so we don't
      // waste a calculation on rejected lines.
      // Stock: variant.trackInventory wins if the variant tracks; else
      // product-level.
      const stockTracked = variant?.trackInventory ?? p.trackInventory;
      const stockLevel = variant?.trackInventory
        ? variant.stockLevel ?? 0
        : p.stockLevel ?? 0;

      const qty = Math.round(Number(raw.qty));
      if (!Number.isFinite(qty) || qty <= 0) {
        lineErrors.push({
          productId: raw.productId,
          message: `Invalid quantity for "${p.name}"`,
        });
        continue;
      }
      if (qty < effectiveMinQty) {
        lineErrors.push({
          productId: raw.productId,
          message: `"${p.name}${variant ? ` (${variant.displayName})` : ""}" needs at least ${effectiveMinQty} ${p.unitLabel}`,
        });
        continue;
      }
      if (effectiveStep > 1 && qty % effectiveStep !== 0) {
        lineErrors.push({
          productId: raw.productId,
          message: `"${p.name}${variant ? ` (${variant.displayName})` : ""}" must be ordered in multiples of ${effectiveStep}`,
        });
        continue;
      }
      if (stockTracked && stockLevel <= 0) {
        lineErrors.push({
          productId: raw.productId,
          message: `"${p.name}${variant ? ` (${variant.displayName})` : ""}" is currently out of stock`,
        });
        continue;
      }

      // Phase D #73: qty is known now, apply volume-tier pricing.
      // Server is authoritative — the client's tier preview is display
      // only, the DB stores the price we compute here.
      const unitPriceCents = effectiveUnitPriceCents(qty, basePrice, tiers);

      prepared.push({
        product: p,
        variant,
        unitPriceCents,
        minOrderQty: effectiveMinQty,
        stepQty: effectiveStep,
        qty,
        notes: raw.notes?.trim() || null,
      });
    }

    if (lineErrors.length > 0) {
      return NextResponse.json(
        {
          error: "Some cart items can't be ordered — see details.",
          lineErrors,
        },
        { status: 422 }
      );
    }

    // (5) Money math. Prices are re-fetched from the live product/variant
    // record, NOT trusted from the client. Merchant sees CURRENT wholesale
    // price, not a stale cached one.
    const subtotalCents = prepared.reduce(
      (sum, p) => sum + p.unitPriceCents * p.qty,
      0
    );
    const taxCents = 0; // Phase C
    const totalCents = subtotalCents + taxCents;

    const minOrder = supplierTenant.supplierProfile?.minOrderCents ?? 0;
    if (minOrder > 0 && subtotalCents < minOrder) {
      return NextResponse.json(
        {
          error: `Order subtotal (${(subtotalCents / 100).toFixed(2)} ${supplierTenant.currency}) is below this supplier's minimum of ${(minOrder / 100).toFixed(2)} ${supplierTenant.currency}. Add more items to continue.`,
        },
        { status: 422 }
      );
    }

    // (6) Snapshot the shipping address from the location — frozen at
    // submit time. Kept as an object so future PO views can render it
    // regardless of what the location record looks like later.
    const shippingAddress = {
      name: location.name,
      address: location.address || null,
      city: location.city || null,
      province: location.province || null,
      postalCode: location.postalCode || null,
      country: location.country,
      phone: location.phone || null,
    };

    // (7) Insert with unique-PO-number retry. If two POs get the same random
    // suffix within a fraction of a second, the unique index rejects one
    // and we regenerate.
    let purchaseOrder = null as null | Awaited<
      ReturnType<typeof prisma.purchaseOrder.create>
    >;
    let attempt = 0;
    const MAX_ATTEMPTS = 5;
    let lastError: unknown = null;

    while (!purchaseOrder && attempt < MAX_ATTEMPTS) {
      attempt++;
      const poNumber = generatePoNumberCandidate();
      try {
        purchaseOrder = await prisma.purchaseOrder.create({
          data: {
            supplierTenantId: supplierId,
            merchantTenantId: tenantId,
            merchantLocationId: locationId,
            relationshipId: relationship.id,
            poNumber,
            status: "SUBMITTED",
            currency: supplierTenant.currency,
            subtotalCents,
            taxCents,
            totalCents,
            shippingAddress,
            notesToSupplier,
            createdByMembershipId: auth.context.membership.id,
            items: {
              create: prepared.map((p) => ({
                productId: p.product.id,
                // Phase D #72: variant reference + snapshot fields. Legacy
                // (simple-product) lines keep variantId null and variant
                // snapshot fields null — the PO detail UI branches on
                // that when rendering.
                variantId: p.variant?.id ?? null,
                productSku: p.variant?.sku ?? p.product.sku,
                productName: p.product.name,
                variantDisplayName: p.variant?.displayName ?? null,
                variantAttributes: p.variant?.attributes ?? undefined,
                unitLabel: p.product.unitLabel,
                unitPriceCents: p.unitPriceCents,
                qty: p.qty,
                lineTotalCents: p.unitPriceCents * p.qty,
                notes: p.notes,
              })),
            },
          },
          include: {
            items: true,
          },
        });
      } catch (err: any) {
        lastError = err;
        // P2002 = unique constraint violation. In our case it can ONLY be
        // the (supplier_tenant_id, po_number) index — anything else is a
        // real bug and should bubble up.
        if (err?.code === "P2002" && err?.meta?.target?.includes?.("po_number")) {
          continue; // regenerate + retry
        }
        throw err;
      }
    }

    if (!purchaseOrder) {
      console.error(
        "[PO-CREATE] Exhausted PO-number attempts",
        lastError
      );
      return NextResponse.json(
        { error: "Failed to allocate a unique PO number. Please try again." },
        { status: 500 }
      );
    }

    console.log(
      `[PO-CREATE] Merchant ${tenantId} → supplier ${supplierId}: ${purchaseOrder.poNumber} (${prepared.length} items, ${(totalCents / 100).toFixed(2)} ${supplierTenant.currency})`
    );

    // Phase C #67 (2026-07-30): if the supplier has an ACTIVE processor,
    // generate a hosted payment link at PO-create time so the merchant sees
    // "Pay with card" immediately. On any failure, log the reason to the
    // PO row and continue — PO creation MUST NOT fail because payment link
    // generation blipped (off-platform payment is still a valid path).
    //
    // 2026-10-04: ECOMMERCE is the semantically correct capability for a
    // hosted PO pay page (card-not-present). We look for ECOMMERCE first;
    // fall back to CARD for legacy suppliers who only ever filled the CARD
    // slot (that was the only option before the ECOMMERCE enum shipped).
    const activeProcessor =
      (await prisma.tenantPaymentProvider.findFirst({
        where: {
          tenantId: supplierId,
          capability: "ECOMMERCE",
          status: "ACTIVE",
        },
        select: {
          id: true,
          processor: true,
          externalMid: true,
          credentialsEnc: true,
        },
      })) ??
      (await prisma.tenantPaymentProvider.findFirst({
        where: {
          tenantId: supplierId,
          capability: "CARD",
          status: "ACTIVE",
        },
        select: {
          id: true,
          processor: true,
          externalMid: true,
          credentialsEnc: true,
        },
      }));

    if (activeProcessor) {
      try {
        // Try to decrypt per-supplier creds. Some providers (Moneris MCO
        // in 2b) don't require them — they fall back to platform env vars —
        // so a decrypt failure downgrades to an empty bag rather than
        // aborting link generation. Providers that genuinely need creds
        // (GP) will throw inside createPaymentLink() when they try to
        // read missing fields, which is correct — the failure surfaces
        // per-provider instead of universally.
        let credentials: Record<string, unknown> = {};
        try {
          const decrypted = kybDecryptJson<Record<string, unknown>>(
            activeProcessor.credentialsEnc
          );
          if (decrypted && typeof decrypted === "object") {
            credentials = decrypted;
          }
        } catch (decryptErr) {
          console.warn(
            `[PO-CREATE] Per-supplier creds for ${purchaseOrder.poNumber} could not be decrypted; passing empty bag to ${activeProcessor.processor} provider:`,
            (decryptErr as Error).message
          );
        }

        const client = getProvider(activeProcessor.processor);
        const link = await client.createPaymentLink({
          purchaseOrderId: purchaseOrder.id,
          poNumber: purchaseOrder.poNumber,
          amountCents: purchaseOrder.totalCents,
          currency: purchaseOrder.currency,
          description: `PO ${purchaseOrder.poNumber}`,
          payerEmail: auth.context.membership.email || undefined,
          returnUrl: `${process.env.NEXT_PUBLIC_BASE_URL || ""}/dashboard/admin/marketplace/orders/${purchaseOrder.id}`,
          webhookUrl: `${process.env.NEXT_PUBLIC_BASE_URL || ""}/api/webhooks/payment/${activeProcessor.processor.toLowerCase()}`,
          credentials,
          externalMid: activeProcessor.externalMid,
        });

        await prisma.purchaseOrder.update({
          where: { id: purchaseOrder.id },
          data: {
            paymentLinkUrl: link.url,
            paymentLinkReference: link.reference,
            paymentLinkExpiresAt: link.expiresAt,
            paymentLinkFailureNote: null, // clear any prior failure state
          },
        });

        console.log(
          `[PO-CREATE] Payment link created for ${purchaseOrder.poNumber}: ref=${link.reference}`
        );
      } catch (err: any) {
        // Store the failure note so admin can see WHY the link is missing
        // without having to dig through logs. Common causes: KYB_ENCRYPTION_KEY
        // mismatch, real processor API blip, missing credential fields.
        const note = String(err?.message || err).slice(0, 500);
        console.error(
          `[PO-CREATE] Payment link generation failed for ${purchaseOrder.poNumber}:`,
          note
        );
        // Best-effort update; ignore any secondary failure here.
        prisma.purchaseOrder
          .update({
            where: { id: purchaseOrder.id },
            data: { paymentLinkFailureNote: note },
          })
          .catch(() => {});
      }
    }

    // Fire-and-forget notification to the supplier. We need the merchant's
    // display name (not id) — fetch it here rather than passing it around,
    // since this is a one-off per PO submit and doesn't dominate the request.
    // Failure is swallowed inside notifyPoSubmitted so the PO still returns
    // success to the merchant client.
    const merchantTenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true },
    });
    notifyPoSubmitted({
      id: purchaseOrder.id,
      poNumber: purchaseOrder.poNumber,
      supplierTenantId: supplierId,
      merchantTenantName: merchantTenant?.name || "A merchant",
      itemCount: purchaseOrder.items.length,
      totalCents: purchaseOrder.totalCents,
      currency: purchaseOrder.currency,
    });

    return NextResponse.json({
      success: true,
      purchaseOrder: {
        id: purchaseOrder.id,
        poNumber: purchaseOrder.poNumber,
        status: purchaseOrder.status,
        totalCents: purchaseOrder.totalCents,
        currency: purchaseOrder.currency,
        submittedAt: purchaseOrder.submittedAt,
        itemCount: purchaseOrder.items.length,
      },
    });
  } catch (error: any) {
    console.error("[PO-CREATE] error:", error);
    return NextResponse.json({ error: "Failed to submit purchase order" }, { status: 500 });
  }
}
