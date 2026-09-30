// Marketplace cart — client-side only, backed by localStorage.
//
// One cart per (merchant tenant, supplier) pair. When a merchant browses
// two different suppliers, each has its own independent cart — you can't
// mix items from two suppliers into a single PO (a PO addresses one
// supplier). Deliberate: matches how B2B ordering actually works.
//
// We keep this OFF the DB in Phase B because:
//   - Draft persistence across devices is a nice-to-have, not a must
//   - Merchants who abandon a cart mid-browse don't leave DB garbage
//   - No DRAFT status on the PO schema → no natural place to put it
//
// If/when we want cross-device draft carts, we add a `draft_carts` table
// without touching the checkout flow — the cart object shape below stays
// the same.

const KEY_PREFIX = "mp_cart_v1"; // v1 lets us change shape later w/o clobbering

export interface CartItem {
  productId: string;
  // Phase D #72 (2026-07-30): variant selection. When the product has
  // variants, cart carries the specific variantId. Simple products keep
  // variantId undefined — server validates the shape at PO submit.
  variantId?: string;
  qty: number;
  addedAt: number; // millis; preserves insertion order across edits
}

export interface Cart {
  supplierTenantId: string;
  merchantTenantId: string;
  items: CartItem[];
  notesToSupplier?: string;
  locationId?: string;
  updatedAt: number;
}

function keyFor(merchantTenantId: string, supplierTenantId: string): string {
  return `${KEY_PREFIX}:${merchantTenantId}:${supplierTenantId}`;
}

function readCart(merchantTenantId: string, supplierTenantId: string): Cart {
  if (typeof window === "undefined") {
    return emptyCart(merchantTenantId, supplierTenantId);
  }
  const raw = window.localStorage.getItem(keyFor(merchantTenantId, supplierTenantId));
  if (!raw) return emptyCart(merchantTenantId, supplierTenantId);
  try {
    const parsed = JSON.parse(raw) as Cart;
    // Sanity checks — if a stale cart from another version leaks in with the
    // wrong shape, fall back to empty rather than crashing the whole page.
    if (
      parsed.merchantTenantId !== merchantTenantId ||
      parsed.supplierTenantId !== supplierTenantId ||
      !Array.isArray(parsed.items)
    ) {
      return emptyCart(merchantTenantId, supplierTenantId);
    }
    return parsed;
  } catch {
    return emptyCart(merchantTenantId, supplierTenantId);
  }
}

function writeCart(cart: Cart): void {
  if (typeof window === "undefined") return;
  cart.updatedAt = Date.now();
  window.localStorage.setItem(keyFor(cart.merchantTenantId, cart.supplierTenantId), JSON.stringify(cart));
  // Broadcast a custom event so a cart badge elsewhere on the page (or in a
  // parent layout) can react without polling. Same-tab only; cross-tab
  // synchronization would need a `storage` event listener but Phase B
  // scope doesn't warrant it.
  window.dispatchEvent(
    new CustomEvent("marketplace-cart-changed", {
      detail: { merchantTenantId: cart.merchantTenantId, supplierTenantId: cart.supplierTenantId },
    })
  );
}

function emptyCart(merchantTenantId: string, supplierTenantId: string): Cart {
  return {
    merchantTenantId,
    supplierTenantId,
    items: [],
    updatedAt: Date.now(),
  };
}

/** Read the current cart. Always returns a Cart — never null. */
export function getCart(merchantTenantId: string, supplierTenantId: string): Cart {
  return readCart(merchantTenantId, supplierTenantId);
}

// Cart items are unique on (productId, variantId). A product with 3
// variants can occupy 3 separate cart rows. Matcher helper keeps every
// mutation using the same equality rule so a subtle drift is impossible.
function sameLine(a: CartItem, productId: string, variantId?: string): boolean {
  return a.productId === productId && (a.variantId ?? null) === (variantId ?? null);
}

/** Add or increment an item. Returns the new cart. */
export function addToCart(
  merchantTenantId: string,
  supplierTenantId: string,
  productId: string,
  qty: number,
  variantId?: string
): Cart {
  const cart = readCart(merchantTenantId, supplierTenantId);
  const existing = cart.items.find((i) => sameLine(i, productId, variantId));
  if (existing) {
    existing.qty += qty;
  } else {
    cart.items.push({ productId, variantId, qty, addedAt: Date.now() });
  }
  writeCart(cart);
  return cart;
}

/** Set an item's qty. Removes the item if qty <= 0. */
export function setQty(
  merchantTenantId: string,
  supplierTenantId: string,
  productId: string,
  qty: number,
  variantId?: string
): Cart {
  const cart = readCart(merchantTenantId, supplierTenantId);
  if (qty <= 0) {
    cart.items = cart.items.filter((i) => !sameLine(i, productId, variantId));
  } else {
    const existing = cart.items.find((i) => sameLine(i, productId, variantId));
    if (existing) existing.qty = qty;
    else cart.items.push({ productId, variantId, qty, addedAt: Date.now() });
  }
  writeCart(cart);
  return cart;
}

/** Remove one item. */
export function removeFromCart(
  merchantTenantId: string,
  supplierTenantId: string,
  productId: string,
  variantId?: string
): Cart {
  const cart = readCart(merchantTenantId, supplierTenantId);
  cart.items = cart.items.filter((i) => !sameLine(i, productId, variantId));
  writeCart(cart);
  return cart;
}

/** Update notes + delivery location together (both are optional). */
export function updateMeta(
  merchantTenantId: string,
  supplierTenantId: string,
  patch: { notesToSupplier?: string; locationId?: string }
): Cart {
  const cart = readCart(merchantTenantId, supplierTenantId);
  if (patch.notesToSupplier !== undefined) cart.notesToSupplier = patch.notesToSupplier;
  if (patch.locationId !== undefined) cart.locationId = patch.locationId;
  writeCart(cart);
  return cart;
}

/** Wipe the cart — call after a successful PO submit. */
export function clearCart(merchantTenantId: string, supplierTenantId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(keyFor(merchantTenantId, supplierTenantId));
  window.dispatchEvent(
    new CustomEvent("marketplace-cart-changed", {
      detail: { merchantTenantId, supplierTenantId },
    })
  );
}

/** Total number of items (summed qtys) — used by the badge. */
export function cartItemCount(cart: Cart): number {
  return cart.items.reduce((sum, i) => sum + i.qty, 0);
}
