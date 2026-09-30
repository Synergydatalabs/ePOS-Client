"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";

interface MenuItem {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  imageUrl?: string;
  variants?: { id: string; name: string; priceAdjustment: number }[];
  productModifierGroups?: {
    modifierGroup: {
      id: string;
      name: string;
      displayName?: string;
      isRequired: boolean;
      minSelect: number;
      maxSelect: number;
      modifiers: { id: string; name: string; price: number; isDefault: boolean }[];
    };
  }[];
  productAllergens?: { allergen: { id: string; code: string; name: string; icon?: string } }[];
}

interface Category {
  id: string;
  name: string;
  products: MenuItem[];
}

interface CartItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  modifiers: any;
  specialInstructions?: string;
  product: { id: string; name: string; imageUrl?: string };
}

interface Guest {
  id: string;
  guestName: string;
  guestToken: string;
  isHost: boolean;
  cartItems: CartItem[];
}

interface TableData {
  id: string;
  tableNumber: string;
  name: string;
}

interface TenantData {
  id: string;
  name: string;
  currency: string;
  logoUrl?: string;
  settings: {
    taxEnabled: boolean;
    taxRate: number;
    taxLabel: string;
    tax2Enabled: boolean;
    tax2Rate: number;
    tax2Label: string;
    tipEnabled: boolean;
    tipPresets: number[];
    tablePaymentType?: "UPFRONT" | "PAY_AT_END";
    tableOrderingEnabled?: boolean;
  };
}

interface ActiveOrder {
  id: string;
  displayNumber: number;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
}

export default function TableOrderPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <TableOrderPageInner />
    </Suspense>
  );
}

function PageFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <Icon
          icon="solar:loading-bold"
          className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-4"
        />
        <p className="text-gray-500">Loading menu...</p>
      </div>
    </div>
  );
}

function TableOrderPageInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qrCode = params.qrCode as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<TableData | null>(null);
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [menu, setMenu] = useState<Category[]>([]);
  const [guest, setGuest] = useState<Guest | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<MenuItem | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [guestName, setGuestName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeOrders, setActiveOrders] = useState<ActiveOrder[]>([]);
  const [showOrderStatus, setShowOrderStatus] = useState(false);

  // Check for order status from URL query
  useEffect(() => {
    const orderStatus = searchParams.get("orderStatus");
    if (orderStatus) {
      setShowOrderStatus(true);
      // Clean URL
      router.replace(`/table/${qrCode}`, { scroll: false });
    }
  }, [searchParams, qrCode, router]);

  // Load table data
  const loadTableData = useCallback(async () => {
    try {
      const res = await fetch(`/api/table/${qrCode}`);
      const data = await res.json();

      if (!data.success) {
        setError(data.error || "Table not found");
        return;
      }

      setTable(data.table);
      setTenant(data.tenant);
      setMenu(data.menu);

      if (data.menu.length > 0) {
        setSelectedCategory(data.menu[0].id);
      }

      // Check for existing guest token
      const storedToken = localStorage.getItem(`tap_guest_${qrCode}`);
      if (storedToken) {
        await joinTable(storedToken);
      } else {
        setShowJoinModal(true);
      }
    } catch (err) {
      setError("Failed to load table");
    } finally {
      setLoading(false);
    }
  }, [qrCode]);

  useEffect(() => {
    loadTableData();
  }, [loadTableData]);

  // Join table as guest
  const joinTable = async (existingToken?: string) => {
    try {
      const res = await fetch(`/api/table/${qrCode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestName: guestName || undefined,
          guestToken: existingToken,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setGuest(data.guest);
        setCart(data.guest.cartItems || []);
        localStorage.setItem(`tap_guest_${qrCode}`, data.guest.guestToken);
        setShowJoinModal(false);
        // Load active orders after joining
        loadActiveOrders(data.guest.guestToken);
      } else {
        // Token invalid, show join modal
        localStorage.removeItem(`tap_guest_${qrCode}`);
        setShowJoinModal(true);
      }
    } catch (err) {
      setShowJoinModal(true);
    }
  };

  // Load active orders for the guest
  const loadActiveOrders = async (token?: string) => {
    const guestToken = token || guest?.guestToken;
    if (!guestToken) return;

    try {
      const res = await fetch(`/api/table/${qrCode}/orders`, {
        headers: { "x-guest-token": guestToken },
      });
      const data = await res.json();
      if (data.success && data.orders) {
        setActiveOrders(data.orders);
      }
    } catch (err) {
      // Silently fail - orders may not exist yet
    }
  };

  // Poll for order status updates
  useEffect(() => {
    if (guest && activeOrders.length > 0) {
      const interval = setInterval(() => {
        loadActiveOrders();
      }, 10000); // Poll every 10 seconds
      return () => clearInterval(interval);
    }
  }, [guest, activeOrders.length]);

  // Add to cart
  const addToCart = async (
    product: MenuItem,
    variantId?: string,
    modifiers?: { modifierId: string; quantity: number }[],
    specialInstructions?: string
  ) => {
    if (!guest) return;

    try {
      const res = await fetch(`/api/table/${qrCode}/cart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-guest-token": guest.guestToken,
        },
        body: JSON.stringify({
          productId: product.id,
          variantId,
          quantity: 1,
          modifiers,
          specialInstructions,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setCart((prev) => [...prev, data.cartItem]);
        toast.success(`Added ${product.name} to cart`);
        setSelectedProduct(null);
      } else {
        toast.error(data.error || "Failed to add to cart");
      }
    } catch (err) {
      toast.error("Failed to add to cart");
    }
  };

  // Update cart item quantity
  const updateCartQuantity = async (cartItemId: string, quantity: number) => {
    if (!guest) return;

    try {
      const res = await fetch(`/api/table/${qrCode}/cart`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-guest-token": guest.guestToken,
        },
        body: JSON.stringify({ cartItemId, quantity }),
      });

      const data = await res.json();
      if (data.success) {
        if (data.deleted) {
          setCart((prev) => prev.filter((item) => item.id !== cartItemId));
        } else {
          setCart((prev) =>
            prev.map((item) =>
              item.id === cartItemId ? { ...item, quantity } : item
            )
          );
        }
      }
    } catch (err) {
      toast.error("Failed to update cart");
    }
  };

  // Remove from cart
  const removeFromCart = async (cartItemId: string) => {
    if (!guest) return;

    try {
      const res = await fetch(`/api/table/${qrCode}/cart?itemId=${cartItemId}`, {
        method: "DELETE",
        headers: { "x-guest-token": guest.guestToken },
      });

      const data = await res.json();
      if (data.success) {
        setCart((prev) => prev.filter((item) => item.id !== cartItemId));
      }
    } catch (err) {
      toast.error("Failed to remove item");
    }
  };

  // Submit order
  const submitOrder = async () => {
    if (!guest || cart.length === 0) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/table/${qrCode}/order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-guest-token": guest.guestToken,
        },
        body: JSON.stringify({}),
      });

      const data = await res.json();
      if (data.success) {
        setCart([]);
        setShowCart(false);

        // Check if UPFRONT payment is required
        if (data.requiresPayment && data.paymentUrl) {
          toast.info("Redirecting to payment...");
          // Navigate to payment page
          router.push(data.paymentUrl);
        } else {
          // PAY_AT_END: Order sent directly to kitchen
          toast.success(`Order #${data.order.displayNumber} submitted!`);
        }
      } else {
        toast.error(data.error || "Failed to submit order");
      }
    } catch (err) {
      toast.error("Failed to submit order");
    } finally {
      setSubmitting(false);
    }
  };

  // Request waiter
  const requestWaiter = async (type: string) => {
    if (!guest) return;

    try {
      const res = await fetch(`/api/table/${qrCode}/request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-guest-token": guest.guestToken,
        },
        body: JSON.stringify({ type }),
      });

      const data = await res.json();
      if (data.success) {
        if (data.alreadyExists) {
          toast.info("Request already pending");
        } else {
          toast.success("Request sent to staff");
        }
      }
    } catch (err) {
      toast.error("Failed to send request");
    }
  };

  // Calculate totals
  const cartSubtotal = cart.reduce((sum, item) => {
    const modifiersTotal = item.modifiers
      ? (item.modifiers as any[]).reduce(
          (m, mod) => m + mod.price * (mod.quantity || 1),
          0
        )
      : 0;
    return sum + (item.unitPrice + modifiersTotal) * item.quantity;
  }, 0);

  const taxRate = tenant?.settings?.taxEnabled ? Number(tenant.settings.taxRate) : 0;
  const taxAmount = Math.round((cartSubtotal * taxRate) / 100);
  const cartTotal = cartSubtotal + taxAmount;
  const cartItemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: tenant?.currency || "CAD",
    }).format(amount / 100);
  };

  // Filter products by category
  const filteredProducts = selectedCategory
    ? menu.find((cat) => cat.id === selectedCategory)?.products || []
    : menu.flatMap((cat) => cat.products);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Icon
            icon="solar:loading-bold"
            className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-4"
          />
          <p className="text-gray-500">Loading menu...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center">
          <Icon
            icon="solar:danger-triangle-bold"
            className="w-16 h-16 text-red-400 mx-auto mb-4"
          />
          <h1 className="text-xl font-semibold text-gray-800 mb-2">
            Table Not Found
          </h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-40">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {tenant?.logoUrl ? (
                <img
                  src={tenant.logoUrl}
                  alt={tenant.name}
                  className="w-10 h-10 rounded-lg object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <Icon
                    icon="solar:shop-2-bold"
                    className="w-6 h-6 text-indigo-600"
                  />
                </div>
              )}
              <div>
                <h1 className="font-semibold text-gray-900">{tenant?.name}</h1>
                <p className="text-sm text-gray-500">Table {table?.tableNumber}</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => requestWaiter("HELP")}
                className="p-2 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                title="Call Waiter"
              >
                <Icon icon="solar:bell-bold" className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Guest info */}
          {guest && (
            <div className="mt-2 flex items-center gap-2 text-sm text-gray-700">
              <Icon icon="solar:user-circle-bold" className="w-4 h-4" />
              <span className="font-medium">{guest.guestName}</span>
              {guest.isHost && (
                <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                  Host
                </span>
              )}
            </div>
          )}
        </div>

        {/* Categories */}
        <div className="px-4 pb-3 overflow-x-auto">
          <div className="flex gap-2">
            {menu.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                  selectedCategory === category.id
                    ? "bg-indigo-600 text-white shadow-md"
                    : "bg-gray-200 text-gray-800 hover:bg-gray-300"
                }`}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Active Orders Status */}
      {activeOrders.length > 0 && (
        <div className="px-4 pt-4">
          <button
            onClick={() => setShowOrderStatus(!showOrderStatus)}
            className="w-full bg-white rounded-xl p-4 shadow-sm flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Icon icon="solar:chef-hat-bold" className="w-5 h-5 text-amber-600" />
              </div>
              <div className="text-left">
                <p className="font-semibold text-gray-900">
                  {activeOrders.length} Active Order{activeOrders.length > 1 ? "s" : ""}
                </p>
                <p className="text-sm text-gray-500">Tap to view status</p>
              </div>
            </div>
            <Icon
              icon={showOrderStatus ? "solar:alt-arrow-up-linear" : "solar:alt-arrow-down-linear"}
              className="w-5 h-5 text-gray-400"
            />
          </button>

          {/* Order Status Details */}
          {showOrderStatus && (
            <div className="mt-2 space-y-2">
              {activeOrders.map((order) => (
                <div
                  key={order.id}
                  className="bg-white rounded-xl p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-gray-900">
                      Order #{order.displayNumber}
                    </span>
                    <span className="text-sm font-medium text-gray-600">
                      {formatPrice(order.total)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {order.status === "PENDING" && (
                      <>
                        <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                        <span className="text-sm text-amber-600">Waiting for confirmation</span>
                      </>
                    )}
                    {order.status === "CONFIRMED" && (
                      <>
                        <Icon icon="solar:chef-hat-bold" className="w-4 h-4 text-blue-500" />
                        <span className="text-sm text-blue-600">Being prepared</span>
                      </>
                    )}
                    {order.status === "PREPARING" && (
                      <>
                        <Icon icon="solar:chef-hat-bold" className="w-4 h-4 text-blue-500 animate-pulse" />
                        <span className="text-sm text-blue-600">Cooking now</span>
                      </>
                    )}
                    {order.status === "READY" && (
                      <>
                        <Icon icon="solar:check-circle-bold" className="w-4 h-4 text-green-500" />
                        <span className="text-sm text-green-600">Ready for pickup</span>
                      </>
                    )}
                    {order.status === "SERVED" && (
                      <>
                        <Icon icon="solar:dish-bold" className="w-4 h-4 text-green-500" />
                        <span className="text-sm text-green-600">Served</span>
                      </>
                    )}
                    {order.status === "COMPLETED" && (
                      <>
                        <Icon icon="solar:check-circle-bold" className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-gray-500">Completed</span>
                      </>
                    )}
                  </div>
                  {order.paymentStatus === "PENDING" && (
                    <div className="mt-2 pt-2 border-t">
                      <span className="text-xs text-red-500">Payment pending</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Menu Items */}
      <main className="p-4">
        <div className="grid gap-4">
          {filteredProducts.map((product) => (
            <div
              key={product.id}
              onClick={() => setSelectedProduct(product)}
              className="bg-white rounded-xl p-4 shadow-sm flex gap-4 cursor-pointer hover:shadow-md transition-shadow"
            >
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="w-24 h-24 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-24 h-24 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Icon
                    icon="solar:dish-bold"
                    className="w-8 h-8 text-gray-300"
                  />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900">{product.name}</h3>
                {product.description && (
                  <p className="text-sm text-gray-600 line-clamp-2 mt-1">
                    {product.description}
                  </p>
                )}
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-bold text-lg text-indigo-600">
                    {formatPrice(product.basePrice)}
                  </span>
                  {product.productAllergens &&
                    product.productAllergens.length > 0 && (
                      <div className="flex gap-1">
                        {product.productAllergens.slice(0, 3).map((pa) => (
                          <span
                            key={pa.allergen.id}
                            className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded"
                            title={pa.allergen.name}
                          >
                            {pa.allergen.code}
                          </span>
                        ))}
                      </div>
                    )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>

      {/* Quick Actions Bar */}
      <div className="fixed bottom-20 left-4 right-4 flex gap-2 z-30">
        <button
          onClick={() => requestWaiter("WATER")}
          className="flex-1 py-3 bg-blue-100 text-blue-700 rounded-xl font-medium flex items-center justify-center gap-2"
        >
          <Icon icon="solar:glass-water-bold" className="w-5 h-5" />
          Water
        </button>
        <button
          onClick={() => requestWaiter("BILL")}
          className="flex-1 py-3 bg-green-100 text-green-700 rounded-xl font-medium flex items-center justify-center gap-2"
        >
          <Icon icon="solar:bill-list-bold" className="w-5 h-5" />
          Bill
        </button>
      </div>

      {/* Cart Button */}
      {cartItemCount > 0 && (
        <button
          onClick={() => setShowCart(true)}
          className="fixed bottom-4 left-4 right-4 bg-indigo-600 text-white py-4 rounded-xl shadow-xl flex items-center justify-between px-5 z-40 hover:bg-indigo-700 active:bg-indigo-800"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white/30 rounded-full flex items-center justify-center">
              <span className="font-bold">{cartItemCount}</span>
            </div>
            <span className="font-semibold text-lg">View Cart</span>
          </div>
          <span className="font-bold text-lg">{formatPrice(cartTotal)}</span>
        </button>
      )}

      {/* Product Modal */}
      {selectedProduct && (
        <ProductModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onAdd={addToCart}
          formatPrice={formatPrice}
        />
      )}

      {/* Cart Modal */}
      {showCart && (
        <CartModal
          cart={cart}
          subtotal={cartSubtotal}
          taxAmount={taxAmount}
          taxLabel={tenant?.settings?.taxLabel || "Tax"}
          total={cartTotal}
          onClose={() => setShowCart(false)}
          onUpdateQuantity={updateCartQuantity}
          onRemove={removeFromCart}
          onSubmit={submitOrder}
          submitting={submitting}
          formatPrice={formatPrice}
        />
      )}

      {/* Join Modal */}
      {showJoinModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-2">Welcome!</h2>
            <p className="text-gray-500 mb-4">
              Enter your name to start ordering from Table {table?.tableNumber}
            </p>
            <input
              type="text"
              placeholder="Your name (optional)"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-4"
            />
            <button
              onClick={() => joinTable()}
              className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700"
            >
              Start Ordering
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Product Modal Component
function ProductModal({
  product,
  onClose,
  onAdd,
  formatPrice,
}: {
  product: MenuItem;
  onClose: () => void;
  onAdd: (
    product: MenuItem,
    variantId?: string,
    modifiers?: any[],
    specialInstructions?: string
  ) => void;
  formatPrice: (amount: number) => string;
}) {
  const [selectedVariant, setSelectedVariant] = useState<string | undefined>(
    product.variants?.[0]?.id
  );
  const [selectedModifiers, setSelectedModifiers] = useState<
    { modifierId: string; quantity: number }[]
  >([]);
  const [instructions, setInstructions] = useState("");

  // Calculate total price
  const variantPrice =
    product.variants?.find((v) => v.id === selectedVariant)?.priceAdjustment || 0;
  const modifiersPrice = selectedModifiers.reduce((sum, mod) => {
    const modifier = product.productModifierGroups
      ?.flatMap((g) => g.modifierGroup.modifiers)
      .find((m) => m.id === mod.modifierId);
    return sum + (modifier?.price || 0) * mod.quantity;
  }, 0);
  const totalPrice = product.basePrice + variantPrice + modifiersPrice;

  const toggleModifier = (modifierId: string) => {
    setSelectedModifiers((prev) => {
      const existing = prev.find((m) => m.modifierId === modifierId);
      if (existing) {
        return prev.filter((m) => m.modifierId !== modifierId);
      }
      return [...prev, { modifierId, quantity: 1 }];
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg max-h-[85vh] sm:max-h-[90vh] rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col">
        {/* Header with Image */}
        <div className="relative flex-shrink-0">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.name}
              className="w-full h-40 sm:h-48 object-cover"
            />
          ) : (
            <div className="w-full h-40 sm:h-48 bg-gray-100 flex items-center justify-center">
              <Icon icon="solar:dish-bold" className="w-16 h-16 text-gray-300" />
            </div>
          )}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow-sm"
          >
            <Icon icon="solar:close-circle-bold" className="w-6 h-6 text-gray-600" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          <h2 className="text-xl font-bold text-gray-900">{product.name}</h2>
          {product.description && (
            <p className="text-gray-500 mt-1">{product.description}</p>
          )}

          {/* Allergens */}
          {product.productAllergens && product.productAllergens.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {product.productAllergens.map((pa) => (
                <span
                  key={pa.allergen.id}
                  className="px-2 py-1 bg-amber-100 text-amber-700 rounded text-sm"
                >
                  {pa.allergen.icon || ""} {pa.allergen.name}
                </span>
              ))}
            </div>
          )}

          {/* Variants */}
          {product.variants && product.variants.length > 0 && (
            <div className="mt-4">
              <h3 className="font-semibold text-gray-800 mb-2">Size</h3>
              <div className="grid grid-cols-3 gap-2">
                {product.variants.map((variant) => (
                  <button
                    key={variant.id}
                    onClick={() => setSelectedVariant(variant.id)}
                    className={`py-2 px-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                      selectedVariant === variant.id
                        ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                        : "border-gray-200 text-gray-700"
                    }`}
                  >
                    {variant.name}
                    {variant.priceAdjustment !== 0 && (
                      <span className="block text-xs text-gray-500">
                        {variant.priceAdjustment > 0 ? "+" : ""}
                        {formatPrice(variant.priceAdjustment)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Modifiers */}
          {product.productModifierGroups?.map((pmg) => (
            <div key={pmg.modifierGroup.id} className="mt-4">
              <h3 className="font-semibold text-gray-800 mb-2">
                {pmg.modifierGroup.displayName || pmg.modifierGroup.name}
                {pmg.modifierGroup.isRequired && (
                  <span className="text-red-500 ml-1">*</span>
                )}
              </h3>
              <div className="space-y-2">
                {pmg.modifierGroup.modifiers.map((modifier) => {
                  const isSelected = selectedModifiers.some(
                    (m) => m.modifierId === modifier.id
                  );
                  return (
                    <button
                      key={modifier.id}
                      onClick={() => toggleModifier(modifier.id)}
                      className={`w-full py-3 px-4 rounded-lg border-2 flex items-center justify-between transition-colors ${
                        isSelected
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-gray-200"
                      }`}
                    >
                      <span className="font-medium text-gray-800">
                        {modifier.name}
                      </span>
                      {modifier.price > 0 && (
                        <span className="text-gray-500">
                          +{formatPrice(modifier.price)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Special Instructions */}
          <div className="mt-4">
            <h3 className="font-semibold text-gray-800 mb-2">
              Special Instructions
            </h3>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Any special requests?"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl resize-none"
              rows={2}
            />
          </div>
        </div>

        {/* Footer - Add to Cart Button */}
        <div className="flex-shrink-0 p-4 border-t bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
          <button
            onClick={() =>
              onAdd(
                product,
                selectedVariant,
                selectedModifiers.length > 0 ? selectedModifiers : undefined,
                instructions || undefined
              )
            }
            className="w-full py-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 active:bg-indigo-800 flex items-center justify-center gap-3 shadow-lg"
          >
            <Icon icon="solar:cart-plus-bold" className="w-5 h-5" />
            <span>Add to Cart</span>
            <span className="font-bold">{formatPrice(totalPrice)}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Cart Modal Component
function CartModal({
  cart,
  subtotal,
  taxAmount,
  taxLabel,
  total,
  onClose,
  onUpdateQuantity,
  onRemove,
  onSubmit,
  submitting,
  formatPrice,
}: {
  cart: CartItem[];
  subtotal: number;
  taxAmount: number;
  taxLabel: string;
  total: number;
  onClose: () => void;
  onUpdateQuantity: (id: string, qty: number) => void;
  onRemove: (id: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  formatPrice: (amount: number) => string;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50">
      <div className="bg-white w-full max-w-lg max-h-[85vh] rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between flex-shrink-0">
          <h2 className="text-xl font-bold text-gray-900">Your Cart</h2>
          <button onClick={onClose}>
            <Icon
              icon="solar:close-circle-bold"
              className="w-6 h-6 text-gray-400"
            />
          </button>
        </div>

        {/* Items - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          {cart.length === 0 ? (
            <div className="text-center py-8">
              <Icon
                icon="solar:cart-large-2-linear"
                className="w-16 h-16 text-gray-300 mx-auto mb-4"
              />
              <p className="text-gray-500">Your cart is empty</p>
            </div>
          ) : (
            <div className="space-y-4">
              {cart.map((item) => (
                <div key={item.id} className="flex gap-3 pb-4 border-b">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900">
                      {item.product.name}
                    </h4>
                    {item.modifiers &&
                      (item.modifiers as any[]).length > 0 && (
                        <p className="text-sm text-gray-500">
                          {(item.modifiers as any[])
                            .map((m) => m.name)
                            .join(", ")}
                        </p>
                      )}
                    <p className="text-sm font-bold text-indigo-600 mt-1">
                      {formatPrice(item.unitPrice)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateQuantity(item.id, item.quantity - 1);
                      }}
                      className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200"
                    >
                      <Icon icon="solar:minus-bold" className="w-4 h-4" />
                    </button>
                    <span className="w-8 text-center font-medium">
                      {item.quantity}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateQuantity(item.id, item.quantity + 1);
                      }}
                      className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center active:bg-gray-200"
                    >
                      <Icon icon="solar:add-bold" className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Totals & Submit - Fixed at bottom */}
        {cart.length > 0 && (
          <div className="flex-shrink-0 p-4 border-t bg-white shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-gray-600">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>{taxLabel}</span>
                <span>{formatPrice(taxAmount)}</span>
              </div>
              <div className="flex justify-between text-lg font-bold text-gray-900">
                <span>Total</span>
                <span>{formatPrice(total)}</span>
              </div>
            </div>
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="w-full py-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
            >
              {submitting ? (
                <>
                  <Icon icon="solar:loading-bold" className="w-5 h-5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Icon icon="solar:bag-check-bold" className="w-5 h-5" />
                  Submit Order • {formatPrice(total)}
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
