"use client";

import { useState, useEffect, useCallback } from "react";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import ProductCard from "@/components/pos/ProductCard";
import CartPanel from "@/components/pos/CartPanel";
import ProductModal from "@/components/pos/ProductModal";
import PaymentModal from "@/components/pos/PaymentModal";
import OrderTypeModal, { OrderTypeSelection } from "@/components/pos/OrderTypeModal";
import CashDrawerModal from "@/components/pos/CashDrawerModal";
import TimeClockModal from "@/components/pos/TimeClockModal";
import DiscountModal, { DiscountApplied } from "@/components/pos/DiscountModal";
import CustomerModal, { AttachedCustomer } from "@/components/pos/CustomerModal";
import BillSplitModal from "@/components/pos/BillSplitModal";
import { useTerminal } from "@/hooks/useTerminal";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";

interface Category {
  id: string;
  name: string;
  _count: { products: number };
}

interface Product {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  imageUrl?: string;
  isAvailable: boolean;
  category?: { id: string; name: string };
  variants?: any[];
  productModifierGroups?: any[];
  productAllergens?: any[];
}

interface CartItem {
  id: string;
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  quantity: number;
  unitPrice: number;
  modifiersTotal: number;
  modifiers?: { name: string; price: number }[];
  specialInstructions?: string;
  allergyNotes?: { allergenId: string; note: string }[];
  // Restaurant DINE_IN — seat assignment (defaults to 1 when unset)
  seat?: number;
}

export default function POSPage() {
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderType, setOrderType] = useState<"DINE_IN" | "TAKEAWAY" | "DELIVERY" | "APPOINTMENT">("TAKEAWAY");
  // Phase 8 QA — appointment fields captured by OrderTypeModal for salon flow.
  const [appointmentDate, setAppointmentDate] = useState<string>("");
  const [appointmentTime, setAppointmentTime] = useState<string>("");
  const [appointmentTechnicianId, setAppointmentTechnicianId] = useState<string>("");
  const [tableNumber, setTableNumber] = useState<string | undefined>();
  // Restaurant DINE_IN only — drives the per-item seat picker in CartPanel.
  const [numberOfSeats, setNumberOfSeats] = useState<number>(1);
  // Optional customer details captured by the OrderTypeModal for Takeaway/Delivery.
  const [customerName, setCustomerName] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState<string>("");
  const [customerAddress, setCustomerAddress] = useState<string>("");

  // Modal state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  // Order-type modal — forces the cashier to confirm Dine In / Takeaway /
  // Delivery (and table / customer details) BEFORE they start adding items,
  // instead of relying on always-visible tabs that are easy to misread.
  const [showOrderTypeModal, setShowOrderTypeModal] = useState(false);
  const [orderTypeConfirmed, setOrderTypeConfirmed] = useState(false);
  // Barcode-scan UI: brief flash on the scanner-ready pill so the operator
  // sees visual feedback when a scan is recognised, plus a manual-entry
  // modal for camera scans or hand-keyed lookups.
  const [scanFlash, setScanFlash] = useState<null | "hit" | "miss">(null);
  const [manualScanOpen, setManualScanOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  // Discount applied to the current cart. Cleared when cart clears / after
  // successful order creation. Persists across the payment modal open/close.
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discount, setDiscount] = useState<DiscountApplied | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customer, setCustomer] = useState<AttachedCustomer | null>(null);
  // Bill-split modal state — separate from splitOrderId (which is used
  // by the split-tender flow in PaymentModal). Once we know the orderId,
  // BillSplitModal takes over collection.
  const [billSplitOrderId, setBillSplitOrderId] = useState<string | null>(null);

  const handleChangeNumberOfSeats = useCallback((n: number) => {
    const clamped = Math.max(1, Math.min(9, Math.round(n)));
    setNumberOfSeats(clamped);
    setCart((prev) =>
      prev.map((item) =>
        (item.seat ?? 1) > clamped ? { ...item, seat: 1 } : item
      )
    );
  }, []);

  const handleChangeItemSeat = useCallback((itemId: string, seat: number) => {
    setCart((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, seat: Math.max(1, Math.round(seat)) } : item
      )
    );
  }, []);

  const handleOrderTypeConfirm = (selection: OrderTypeSelection) => {
    setOrderType(selection.orderType);
    setTableNumber(selection.tableId);
    setNumberOfSeats(selection.numberOfSeats || 1);
    setCustomerName(selection.customerName || "");
    setCustomerPhone(selection.customerPhone || "");
    setCustomerAddress(selection.customerAddress || "");
    // Phase 8 QA — appointment fields (empty for non-appointment orders).
    setAppointmentDate(selection.appointmentDate || "");
    setAppointmentTime(selection.appointmentTime || "");
    setAppointmentTechnicianId(selection.technicianId || "");
    setOrderTypeConfirmed(true);
    setShowOrderTypeModal(false);
  };

  const handleOrderTypeModalClose = () => {
    setShowOrderTypeModal(false);
    // Closing the modal WITHOUT confirming an explicit choice = the cashier
    // opened it by mistake OR simply doesn't want the flow right now.
    // Fall back to the sensible default for the business type so the cart
    // is still usable; the pill stays clickable so they can switch later.
    if (!orderTypeConfirmed) {
      // Salon defaults to APPOINTMENT — but without date/time it can't
      // actually be saved, so we keep the modal closed and let the
      // operator re-open it. For restaurant/retail the fallback is
      // Takeaway which is always a valid tender.
      setOrderType(businessType === "salon" ? "APPOINTMENT" : "TAKEAWAY");
      setOrderTypeConfirmed(true);
    }
  };

  // Settings
  const [settings, setSettings] = useState<any>(null);
  const [currency, setCurrency] = useState("CAD");
  const [businessType, setBusinessType] = useState("restaurant");
  // Phase 8 QA: prevents the OrderTypeModal from opening with restaurant
  // options during the ~200ms before the settings fetch resolves.
  // Without this, salon users see a flash of DINE_IN/TAKEAWAY/DELIVERY
  // before the modal switches to APPOINTMENT.
  const [businessTypeLoaded, setBusinessTypeLoaded] = useState(false);

  // Browser-side terminal communication
  const {
    terminal: activeTerminal,
    isOnline: terminalOnline,
    paymentState: terminalPaymentState,
    lastResult: terminalResult,
    processPayment: terminalProcessPayment,
    cancelTransaction: terminalCancel,
    recoverLastTransaction: terminalRecover,
    resetPaymentState: terminalReset,
  } = useTerminal(tenantId);

  // Load tenant and location - check localStorage first, then fetch from session/API
  useEffect(() => {
    const initTenantAndLocation = async () => {
      // Try localStorage first
      let storedTenant = localStorage.getItem("tap_active_tenant");
      let storedLocation = localStorage.getItem("tap_active_location");

      // If no tenant in localStorage, try to get from session
      if (!storedTenant) {
        try {
          const sessionRes = await fetch("/api/auth/session");
          const sessionData = await sessionRes.json();
          if (sessionData.authenticated && sessionData.memberships?.length > 0) {
            // Use first membership's tenant
            storedTenant = sessionData.memberships[0].tenantId;
            if (storedTenant) {
              localStorage.setItem("tap_active_tenant", storedTenant);
            }
          }
        } catch (error) {
          console.error("Failed to get session:", error);
        }
      }

      if (storedTenant) {
        setTenantId(storedTenant);

        // If no location, fetch first available location
        if (!storedLocation) {
          try {
            const locRes = await fetch(`/api/tenants/${storedTenant}/locations`);
            const locData = await locRes.json();
            if (locData.success && locData.locations?.length > 0) {
              storedLocation = locData.locations[0].id;
              localStorage.setItem("tap_active_location", storedLocation);
            }
          } catch (error) {
            console.error("Failed to get locations:", error);
          }
        }

        if (storedLocation) {
          setLocationId(storedLocation);
        }
      }
    };

    initTenantAndLocation();
  }, []);

  // Load categories and products
  const loadData = useCallback(async () => {
    if (!tenantId) return;

    setLoading(true);
    try {
      const [catRes, prodRes, settingsRes] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/categories`),
        fetch(`/api/tenants/${tenantId}/products`),
        fetch(`/api/tenants/${tenantId}/settings`),
      ]);

      const catData = await catRes.json();
      const prodData = await prodRes.json();
      const settingsData = await settingsRes.json();

      if (catData.success) setCategories(catData.categories);
      if (prodData.success) setProducts(prodData.products);
      if (settingsData.success) {
        setSettings(settingsData.settings);
        setCurrency(settingsData.tenant?.currency || "CAD");
        if (settingsData.tenant?.businessType) {
          setBusinessType(settingsData.tenant.businessType);
        }
        setBusinessTypeLoaded(true);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
      toast.error("Failed to load menu");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (tenantId) {
      loadData();
    }
  }, [tenantId, loadData]);

  // Once we know the business type, force the cashier to confirm the
  // order type before adding items. Salon needs it too — appointment
  // date/time/customer must be captured up-front. Retail could skip
  // (fixed to in-store sale) but the modal is trivial there so we
  // still show it for consistency until Phase E introduces per-tenant
  // configurable order types.
  useEffect(() => {
    // Wait for the real businessType before deciding.
    if (!businessTypeLoaded) return;
    // Restaurant needs the modal up-front (Dine In vs Takeaway vs
    // Delivery changes what the operator captures next). Salon does
    // NOT — the operator wants to see the menu and build the cart
    // first, then confirm appointment details at checkout. Retail is
    // fixed to in-store sale so no modal needed.
    if (businessType === "restaurant" && !orderTypeConfirmed) {
      setShowOrderTypeModal(true);
    }
  }, [businessType, businessTypeLoaded, orderTypeConfirmed]);

  // Salon: pre-mark orderType so the cart works immediately. Modal
  // opens only when the operator hits Checkout (handled downstream).
  useEffect(() => {
    if (!businessTypeLoaded) return;
    if (businessType === "salon" && !orderTypeConfirmed) {
      setOrderType("APPOINTMENT");
      setOrderTypeConfirmed(true);
    } else if (businessType === "retail" && !orderTypeConfirmed) {
      setOrderType("TAKEAWAY"); // in-store sale
      setOrderTypeConfirmed(true);
    }
  }, [businessType, businessTypeLoaded, orderTypeConfirmed]);

  // Filter products
  const filteredProducts = products.filter((product) => {
    const matchesCategory = !selectedCategory || product.category?.id === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Calculate totals — discount comes off the subtotal before tax so the
  // customer isn't charged tax on the discounted portion (matches how
  // Order.total is computed server-side).
  const subtotal = cart.reduce(
    (sum, item) => sum + (item.unitPrice + item.modifiersTotal) * item.quantity,
    0
  );
  const discountAmount = discount
    ? Math.min(discount.amount, subtotal)
    : 0;
  const taxableSubtotal = Math.max(0, subtotal - discountAmount);
  const taxRate = settings?.taxEnabled ? Number(settings.taxRate) : 0;
  const taxAmount = Math.round((taxableSubtotal * taxRate) / 100);
  const total = taxableSubtotal + taxAmount;

  // Cart operations
  const handleAddToCart = (data: any) => {
    const product = products.find((p) => p.id === data.productId);
    if (!product) return;

    const variant = data.variantId
      ? product.variants?.find((v: any) => v.id === data.variantId)
      : null;

    // Calculate modifier details
    let modifiersTotal = 0;
    const modifierDetails: { name: string; price: number }[] = [];

    if (data.modifiers?.length) {
      for (const mod of data.modifiers) {
        const modifierGroup = product.productModifierGroups?.find((g: any) =>
          g.modifierGroup.modifiers.some((m: any) => m.id === mod.modifierId)
        );
        const modifier = modifierGroup?.modifierGroup.modifiers.find(
          (m: any) => m.id === mod.modifierId
        );
        if (modifier) {
          modifiersTotal += modifier.price * mod.quantity;
          modifierDetails.push({ name: modifier.name, price: modifier.price });
        }
      }
    }

    const unitPrice = product.basePrice + (variant?.priceAdjustment || 0);

    const cartItem: CartItem = {
      id: `${Date.now()}-${Math.random()}`,
      productId: product.id,
      productName: product.name,
      variantId: variant?.id,
      variantName: variant?.name,
      quantity: data.quantity,
      unitPrice,
      modifiersTotal,
      modifiers: modifierDetails,
      specialInstructions: data.specialInstructions,
      allergyNotes: data.allergyNotes,
    };

    setCart((prev) => [...prev, cartItem]);
    toast.success(`Added ${product.name} to cart`);
  };

  // Look up a scanned/typed code and either drop it into the cart or open
  // the product modal so the operator can choose variant/modifiers.
  // Products with variants or modifier groups need explicit choice — we
  // never guess a variant just because the barcode is on the parent product.
  const lookupAndAdd = useCallback(
    async (code: string) => {
      if (!tenantId) return;
      try {
        const res = await fetch(
          `/api/tenants/${tenantId}/products/lookup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          }
        );
        if (!res.ok) {
          setScanFlash("miss");
          setTimeout(() => setScanFlash(null), 800);
          toast.error(`No product matches "${code}"`);
          return;
        }
        const data = await res.json();
        const product = data.product;
        setScanFlash("hit");
        setTimeout(() => setScanFlash(null), 800);

        const needsChoice =
          (product.variants && product.variants.length > 0) ||
          (product.productModifierGroups &&
            product.productModifierGroups.length > 0);

        if (needsChoice) {
          setSelectedProduct(product);
          setProductModalOpen(true);
        } else {
          handleAddToCart({ productId: product.id, quantity: 1 });
        }
      } catch {
        toast.error("Lookup failed");
      }
    },
    [tenantId]
  );

  // Arm the global scanner only when the operator has confirmed an order
  // type and no modal is open — otherwise a scan could add items to a cart
  // in the wrong state or steal keystrokes from an active modal.
  useBarcodeScanner({
    onScan: lookupAndAdd,
    enabled:
      !!tenantId &&
      orderTypeConfirmed &&
      !paymentModalOpen &&
      !productModalOpen &&
      !manualScanOpen,
  });

  const handleUpdateQuantity = (itemId: string, quantity: number) => {
    setCart((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, quantity } : item))
    );
  };

  const handleRemoveItem = (itemId: string) => {
    setCart((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleClearCart = () => {
    setCart([]);
    setDiscount(null);
    setCustomer(null);
    toast.info("Cart cleared");
  };

  // Handle product click
  const handleProductClick = (product: Product) => {
    // If product has variants or modifiers, show modal
    if (
      (product.variants && product.variants.length > 0) ||
      (product.productModifierGroups && product.productModifierGroups.length > 0) ||
      (product.productAllergens && product.productAllergens.length > 0)
    ) {
      setSelectedProduct(product);
      setProductModalOpen(true);
    } else {
      // Quick add to cart
      handleAddToCart({
        productId: product.id,
        quantity: 1,
        modifiers: [],
      });
    }
  };

  // Handle checkout
  const handleCheckout = () => {
    if (cart.length === 0) return;
    setPaymentModalOpen(true);
  };

  // Handle payment
  const handlePayment = async (
    method: string,
    amount?: number,
    extras?: {
      code?: string;
      orderId?: string;
      surchargeAmount?: number;
      cashDiscountAmount?: number;
      cashDiscountReason?: string;
      // Phase 8 QA: POS-side tip on Cash or QR flows.
      tipAmount?: number;
    }
  ) => {
    if (!tenantId || !locationId) {
      return { success: false };
    }

    try {
      // For split-tender payments beyond the first, extras.orderId is set
      // to the order created on tender #1 — reuse it instead of creating
      // a second order.
      let orderData: any;
      if (extras?.orderId) {
        orderData = {
          success: true,
          order: { id: extras.orderId, orderNumber: "" },
        };
      } else {
        // Create order. For APPOINTMENT orders every line item shares
        // the same technician picked in the OrderTypeModal — Phase E
        // will allow per-item overrides (e.g. one item with tech A,
        // another with tech B in the same visit).
        const orderItems = cart.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          modifiers: item.modifiers?.map((m) => ({ modifierId: m.name, quantity: 1 })),
          specialInstructions: item.specialInstructions,
          allergyNotes: item.allergyNotes,
          ...(orderType === "APPOINTMENT" &&
            appointmentTechnicianId && {
              technicianId: appointmentTechnicianId,
            }),
        }));

        const orderRes = await fetch(`/api/tenants/${tenantId}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId,
            orderType,
            tableId: orderType === "DINE_IN" ? tableNumber : undefined,
            items: orderItems,
            // Discount — server re-derives totals from these, so we send the
            // resolved amount + audit fields together.
            // Combines line-level discount (promotion / manual) with the
            // cash-discount when the operator paid with cash.
            discountAmount: (discountAmount || 0) + (extras?.cashDiscountAmount || 0),
            promotionId: discount?.promotionId,
            discountCode: discount?.code,
            discountReason: [discount?.reason, extras?.cashDiscountReason]
              .filter(Boolean)
              .join(" · ") || undefined,
            // Card-processing surcharge (SURCHARGE mode, non-cash tender)
            surchargeAmount: extras?.surchargeAmount || 0,
            // Phase 8 QA: pre-set tip on Cash/QR. Server re-derives total
            // from these fields so this is the single source of truth.
            tipAmount: extras?.tipAmount || 0,
            // Attached customer — sent as denormalized fields since Order
            // stores customer* as strings, not a guestProfileId FK.
            // For APPOINTMENT orders, the OrderTypeModal captured the
            // customer directly (no attached-customer flow yet) so we
            // fall back to those fields.
            customerName: customer
              ? `${customer.firstName}${customer.lastName ? " " + customer.lastName : ""}`
              : orderType === "APPOINTMENT" && customerName
                ? customerName
                : undefined,
            customerPhone:
              customer?.phone ||
              (orderType === "APPOINTMENT" ? customerPhone : undefined) ||
              undefined,
            customerEmail: customer?.email || undefined,
            // Phase 8 QA: appointment fields. Schema already has these
            // columns on Order (appointmentDate/appointmentTime).
            // technicianId lives per-item and is attached above.
            ...(orderType === "APPOINTMENT" && {
              appointmentDate: appointmentDate || undefined,
              appointmentTime: appointmentTime || undefined,
            }),
          }),
        });

        orderData = await orderRes.json();

        if (!orderData.success) {
          toast.error("Failed to create order");
          return { success: false };
        }
      }

      // For TERMINAL_INTENT: just create the order, browser handles terminal
      if (method === "TERMINAL_INTENT") {
        return {
          success: true,
          orderId: orderData.order.id,
          orderNumber: orderData.order.orderNumber,
        };
      }

      // Gift card — order is now created, redeem card against it. If the
      // card fully covers the order we clear cart; if it's a partial the
      // POS will see remainingOnOrder > 0 and the operator can re-open the
      // payment modal with another method for the shortfall.
      if (method === "GIFT_CARD") {
        const code = extras?.code || "";
        const redeemRes = await fetch(
          `/api/tenants/${tenantId}/orders/${orderData.order.id}/redeem-gift-card`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code }),
          }
        );
        const redeemData = await redeemRes.json();
        if (!redeemData.success) {
          toast.error(redeemData.error || "Gift card redemption failed");
          return { success: false, error: redeemData.error };
        }
        if (redeemData.remainingOnOrder === 0) {
          setCart([]);
          setDiscount(null);
          setCustomer(null);
          toast.success("Paid with gift card");
        } else {
          toast.success(
            `Applied gift card — ${new Intl.NumberFormat("en-CA", {
              style: "currency",
              currency,
            }).format(redeemData.remainingOnOrder / 100)} still due`
          );
        }
        return {
          success: true,
          orderId: orderData.order.id,
          orderNumber: orderData.order.orderNumber,
          giftCard: {
            applied: redeemData.applied,
            remainingOnCard: redeemData.remainingOnCard,
            remainingOnOrder: redeemData.remainingOnOrder,
          },
        };
      }

      // Process payment
      const paymentRes = await fetch(
        `/api/tenants/${tenantId}/orders/${orderData.order.id}/payment`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ method, amount }),
        }
      );

      const paymentData = await paymentRes.json();

      if (paymentData.success) {
        // For QR/Online payment, don't clear cart yet - payment is pending
        if (method === "ONLINE") {
          toast.success("QR Code generated - present to customer");
          // Build QR URL from the current browser origin so the customer
          // lands on the same domain the cashier is viewing. This makes
          // partner-domain testing work (oreugo.ca staff → oreugo.ca QR)
          // and avoids hardcoding itap.zashx.com.
          const origin =
            typeof window !== "undefined" ? window.location.origin : "";
          const paymentUrl =
            paymentData.paymentUrl ||
            paymentData.qrPayload ||
            `${origin}/pay/${orderData.order.id}`;

          // If the API returned an absolute URL on a different host,
          // override to current host. (Old behavior would send oreugo
          // customers to itap.zashx.com which they can't trust.)
          let qrCode = paymentUrl;
          try {
            const parsed = new URL(paymentUrl, origin || undefined);
            if (origin && parsed.host !== new URL(origin).host) {
              qrCode = `${origin}${parsed.pathname}${parsed.search}`;
            }
          } catch {
            qrCode = `${origin}/pay/${orderData.order.id}`;
          }

          return {
            success: true,
            qrCode,
            orderId: orderData.order.id,
            orderNumber: orderData.order.orderNumber,
          };
        }

        // Only clear the cart once the order is fully paid — split-tender
        // payments come back with remaining > 0 until the final tender.
        const fullyPaid = (paymentData.remaining ?? 0) <= 0;
        if (fullyPaid) {
          setCart([]);
          setDiscount(null);
          setCustomer(null);
          toast.success("Order completed!");
        } else {
          toast.success(
            `Applied ${new Intl.NumberFormat("en-CA", {
              style: "currency",
              currency,
            }).format(paymentData.applied / 100)} — ${new Intl.NumberFormat("en-CA", {
              style: "currency",
              currency,
            }).format(paymentData.remaining / 100)} still due`
          );
        }
        return {
          success: true,
          change: paymentData.change,
          applied: paymentData.applied,
          remaining: paymentData.remaining,
          orderId: orderData.order.id,
          orderNumber: orderData.order.orderNumber,
        };
      }

      return { success: false };
    } catch (error) {
      console.error("Payment error:", error);
      toast.error("Payment failed");
      return { success: false };
    }
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  if (!tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Icon icon="solar:shop-2-bold" className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">Please select a business first</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-gray-50">
      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar — three stacked rows for clearer cashier flow:
            (1) Order type   (2) Categories   (3) Search                  */}
        <div className="bg-white border-b border-gray-200 px-4 py-3 space-y-3">
          {/* Row 1: Order Type — restaurant only.
              Shown as a compact pill/badge with a "New Order" button so
              the cashier can't accidentally leave the wrong type selected.
              Actual type is chosen via the OrderTypeModal (auto-opens on
              first load, opens again after each completed sale). */}
          {businessType === "restaurant" && orderTypeConfirmed && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowOrderTypeModal(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-teal-50 text-teal-700 hover:bg-teal-100 font-semibold text-sm transition-colors"
                title="Change order type"
              >
                <Icon
                  icon={
                    orderType === "DINE_IN"
                      ? "solar:chair-2-bold"
                      : orderType === "TAKEAWAY"
                      ? "solar:bag-4-bold"
                      : "solar:delivery-bold"
                  }
                  className="w-5 h-5"
                />
                <span>
                  {orderType === "DINE_IN"
                    ? "Dine In"
                    : orderType === "TAKEAWAY"
                    ? "Takeaway"
                    : "Delivery"}
                </span>
                {orderType === "DINE_IN" && numberOfSeats > 1 && (
                  <span className="text-xs bg-teal-200 rounded-full px-2 py-0.5">
                    {numberOfSeats} guests
                  </span>
                )}
                {(orderType === "TAKEAWAY" || orderType === "DELIVERY") &&
                  customerName && (
                    <span className="text-xs bg-teal-200 rounded-full px-2 py-0.5 truncate max-w-[140px]">
                      {customerName}
                    </span>
                  )}
                <Icon
                  icon="solar:pen-2-linear"
                  className="w-4 h-4 ml-1 opacity-60"
                />
              </button>
              <button
                onClick={() => {
                  if (
                    cart.length > 0 &&
                    !confirm(
                      "Clear current cart and start a brand new order?"
                    )
                  ) {
                    return;
                  }
                  setCart([]);
                  setNumberOfSeats(1);
                  setCustomerName("");
                  setCustomerPhone("");
                  setCustomerAddress("");
                  setOrderTypeConfirmed(false);
                  setShowOrderTypeModal(true);
                }}
                className="px-4 py-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 font-semibold text-sm transition-colors flex items-center gap-2"
                title="Start a new order"
              >
                <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
                New Order
              </button>
            </div>
          )}
          {businessType === "salon" && (
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-50 rounded-xl w-fit">
              <Icon icon="solar:calendar-bold" className="w-5 h-5 text-purple-600" />
              <span className="text-sm font-medium text-purple-700">Appointment</span>
            </div>
          )}
          {businessType === "retail" && (
            <div className="flex items-center gap-2 px-3 py-2 bg-teal-50 rounded-xl w-fit">
              <Icon icon="solar:bag-heart-bold" className="w-5 h-5 text-teal-600" />
              <span className="text-sm font-medium text-teal-700">Sale</span>
            </div>
          )}

          {/* Row 2: Full-width category bar */}
          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`pos-category-btn ${!selectedCategory ? "active" : ""}`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`pos-category-btn ${
                  selectedCategory === cat.id ? "active" : ""
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>

          {/* Row 3: Search + Scanner controls */}
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <Icon
                icon="solar:magnifer-linear"
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none"
              />
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input !pl-11"
              />
            </div>
            {/* Scanner-ready pill — flashes green on a hit, red on a miss */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                scanFlash === "hit"
                  ? "bg-green-50 border-green-200 text-green-700"
                  : scanFlash === "miss"
                    ? "bg-red-50 border-red-200 text-red-700"
                    : "bg-gray-50 border-gray-200 text-gray-500"
              }`}
              title="USB barcode scanners work automatically"
            >
              <Icon
                icon={
                  scanFlash === "hit"
                    ? "solar:check-circle-bold"
                    : scanFlash === "miss"
                      ? "solar:close-circle-bold"
                      : "solar:qr-code-bold"
                }
                className="w-4 h-4"
              />
              <span>
                {scanFlash === "hit"
                  ? "Scanned"
                  : scanFlash === "miss"
                    ? "No match"
                    : "Scanner ready"}
              </span>
            </div>
            {/* Manual entry — camera/handkey fallback */}
            <button
              onClick={() => setManualScanOpen(true)}
              className="px-3 py-2 rounded-xl border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 transition-colors"
              title="Enter barcode manually"
            >
              <Icon icon="solar:scanner-2-bold" className="w-5 h-5" />
            </button>
            {/* Cash drawer — opens the drawer manager modal (open, add movement, close) */}
            <button
              onClick={() => setDrawerOpen(true)}
              className="px-3 py-2 rounded-xl border border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 text-gray-600 hover:text-emerald-600 transition-colors"
              title="Cash drawer"
            >
              <Icon icon="solar:wallet-2-bold" className="w-5 h-5" />
            </button>
            {/* Time clock — clock in/out + breaks */}
            <button
              onClick={() => setClockOpen(true)}
              className="px-3 py-2 rounded-xl border border-gray-200 hover:border-purple-400 hover:bg-purple-50 text-gray-600 hover:text-purple-600 transition-colors"
              title="Time clock"
            >
              <Icon icon="solar:clock-circle-bold" className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Products Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="bg-white rounded-2xl p-4 animate-pulse">
                  <div className="aspect-square bg-gray-200 rounded-xl mb-3" />
                  <div className="h-4 bg-gray-200 rounded mb-2" />
                  <div className="h-4 bg-gray-200 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400">
              <Icon icon="solar:box-linear" className="w-20 h-20 mb-4" />
              <p className="text-lg font-medium">No products found</p>
              {searchQuery && (
                <p className="text-sm">Try a different search term</p>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  id={product.id}
                  name={product.name}
                  price={product.basePrice}
                  imageUrl={product.imageUrl}
                  isAvailable={product.isAvailable}
                  hasVariants={(product.variants?.length || 0) > 0}
                  hasModifiers={(product.productModifierGroups?.length || 0) > 0}
                  hasAllergens={(product.productAllergens?.length || 0) > 0}
                  currency={currency}
                  onClick={() => handleProductClick(product)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Mobile Cart Summary (only on small screens) */}
        <div className="lg:hidden border-t border-gray-200 bg-white p-4">
          <button
            onClick={handleCheckout}
            disabled={cart.length === 0}
            className="btn btn-primary btn-lg w-full"
          >
            <span className="flex-1 text-left">
              {cart.length} item{cart.length !== 1 ? "s" : ""}
            </span>
            <span className="font-bold">{formatPrice(total)}</span>
            <Icon icon="solar:arrow-right-linear" className="w-5 h-5 ml-2" />
          </button>
        </div>
      </div>

      {/* Cart Panel (hidden on mobile) */}
      <div className="hidden lg:block w-96">
        <CartPanel
          items={cart}
          subtotal={subtotal}
          taxAmount={taxAmount}
          total={total}
          currency={currency}
          orderType={orderType}
          tableNumber={tableNumber}
          onUpdateQuantity={handleUpdateQuantity}
          onRemoveItem={handleRemoveItem}
          onClearCart={handleClearCart}
          onCheckout={handleCheckout}
          onChangeOrderType={setOrderType}
          businessType={businessType}
          numberOfSeats={numberOfSeats}
          onChangeNumberOfSeats={handleChangeNumberOfSeats}
          onChangeItemSeat={handleChangeItemSeat}
          discountAmount={discountAmount}
          discountLabel={discount?.reason}
          onOpenDiscount={() => setDiscountOpen(true)}
          onRemoveDiscount={() => setDiscount(null)}
          customerName={
            customer
              ? `${customer.firstName}${customer.lastName ? " " + customer.lastName : ""}`
              : orderType === "APPOINTMENT" && customerName
                ? customerName
                : undefined
          }
          customerSubline={
            customer
              ? [customer.phone, customer.email].filter(Boolean).join(" · ") ||
                undefined
              : // Phase 8 QA: for appointment orders show the picked
                // date/time (+ tech if named) as the subline so the
                // operator sees "You're building an appointment for
                // Jamie Chen · Aug 3 at 2:00 PM" instead of losing
                // track after the Start Order click.
                orderType === "APPOINTMENT"
                ? [
                    customerPhone || undefined,
                    appointmentDate && appointmentTime
                      ? `${new Date(appointmentDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })} at ${(() => {
                          const [h, m] = appointmentTime.split(":").map(Number);
                          const ampm = h >= 12 ? "PM" : "AM";
                          const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                          return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
                        })()}`
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ") || undefined
                : undefined
          }
          onOpenCustomer={() => setCustomerOpen(true)}
          onRemoveCustomer={() => setCustomer(null)}
        />
      </div>

      {/* Product Modal */}
      <ProductModal
        isOpen={productModalOpen}
        onClose={() => {
          setProductModalOpen(false);
          setSelectedProduct(null);
        }}
        product={
          selectedProduct
            ? {
                ...selectedProduct,
                variants: selectedProduct.variants,
                modifierGroups: selectedProduct.productModifierGroups?.map(
                  (g: any) => g.modifierGroup
                ),
                allergens: selectedProduct.productAllergens?.map(
                  (a: any) => a.allergen
                ),
              }
            : null
        }
        currency={currency}
        onAddToCart={handleAddToCart}
      />

      {/* Payment Modal */}
      <PaymentModal
        cashDiscount={
          settings?.cashDiscountEnabled
            ? {
                enabled: true,
                percent: Number(settings.cashDiscountPercent) || 0,
                mode: (settings.cashDiscountMode || "SURCHARGE") as "SURCHARGE" | "DISCOUNT",
                label: settings.cashDiscountLabel,
              }
            : undefined
        }
        onSplitBill={
          // Only offer bill split for DINE_IN — other order types
          // don't have the "N guests at one table" concept.
          orderType === "DINE_IN"
            ? async () => {
                // Create the order via TERMINAL_INTENT path so we get an
                // orderId, then open BillSplitModal. If the order already
                // exists (split-tender partial), reuse it.
                const res = await handlePayment("TERMINAL_INTENT", total);
                if (res.success && res.orderId) {
                  setPaymentModalOpen(false);
                  setBillSplitOrderId(res.orderId);
                }
              }
            : undefined
        }
        isOpen={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        total={total}
        currency={currency}
        onPayment={handlePayment}
        onPaymentComplete={() => {
          setCart([]);
          setNumberOfSeats(1);
          setCustomerName("");
          setCustomerPhone("");
          setCustomerAddress("");
          // Force the order-type modal to reopen for the next order so the
          // cashier explicitly confirms Dine In / Takeaway / Delivery again.
          if (businessType === "restaurant") {
            setOrderTypeConfirmed(false);
          }
        }}
        tenantId={tenantId || undefined}
        // Browser-side terminal props
        terminalConnected={terminalOnline}
        terminalName={activeTerminal?.name}
        onTerminalPayment={terminalProcessPayment}
        onTerminalCancel={terminalCancel}
        onTerminalRecover={terminalRecover}
        terminalPaymentState={terminalPaymentState}
        terminalResult={terminalResult}
        onResetTerminal={terminalReset}
      />

      {/* Order-type modal — mandatory before adding items for restaurants.
          Salon → single Appointment option auto-selected. */}
      <OrderTypeModal
        isOpen={showOrderTypeModal}
        onClose={handleOrderTypeModalClose}
        onConfirm={handleOrderTypeConfirm}
        tenantId={tenantId}
        locationId={locationId}
        currentType={orderTypeConfirmed ? orderType : undefined}
        currentTableId={
          orderTypeConfirmed && orderType === "DINE_IN" ? tableNumber : undefined
        }
        currentSeats={numberOfSeats}
        hasCartItems={cart.length > 0}
        businessType={businessType}
      />

      {/* Manual barcode entry — for camera-based scans or hand-keyed codes */}
      {manualScanOpen && (
        <ManualBarcodeModal
          onClose={() => setManualScanOpen(false)}
          onSubmit={(code) => {
            setManualScanOpen(false);
            lookupAndAdd(code);
          }}
        />
      )}

      {/* Cash drawer — open/close, add pay-in/pay-out/drop movements */}
      {drawerOpen && tenantId && locationId && (
        <CashDrawerModal
          isOpen={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          tenantId={tenantId}
          locationId={locationId}
          currency={currency}
        />
      )}

      {/* Time clock */}
      {clockOpen && tenantId && locationId && (
        <TimeClockModal
          isOpen={clockOpen}
          onClose={() => setClockOpen(false)}
          tenantId={tenantId}
          locationId={locationId}
        />
      )}

      {/* Discount — promo code or manual %/$ off */}
      {discountOpen && tenantId && (
        <DiscountModal
          isOpen={discountOpen}
          onClose={() => setDiscountOpen(false)}
          tenantId={tenantId}
          cartSubtotal={subtotal}
          currency={currency}
          onApply={(d) => setDiscount(d)}
        />
      )}

      {/* Customer — search / create / attach */}
      {customerOpen && tenantId && (
        <CustomerModal
          isOpen={customerOpen}
          onClose={() => setCustomerOpen(false)}
          tenantId={tenantId}
          currency={currency}
          onAttach={(c) => setCustomer(c)}
        />
      )}

      {/* Bill split modal — opens after an order is created via the
          Split Bill button on PaymentModal. Handles per-guest collection. */}
      {billSplitOrderId && tenantId && (
        <BillSplitModal
          isOpen={true}
          onClose={() => setBillSplitOrderId(null)}
          tenantId={tenantId}
          orderId={billSplitOrderId}
          orderTotal={total}
          currency={currency}
          onAllPaid={() => {
            // Clear cart / discount / customer state — order is fully
            // collected via the individual split payments.
            setCart([]);
            setDiscount(null);
            setCustomer(null);
            setBillSplitOrderId(null);
            toast.success("Order fully paid via split");
          }}
        />
      )}
    </div>
  );
}

// Small self-contained manual entry modal. Rendered inline so we don't
// need a whole new file for a 30-line component.
function ManualBarcodeModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (code: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Icon icon="solar:scanner-2-bold" className="w-6 h-6" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900">
            Enter Barcode / SKU
          </h3>
        </div>
        <input
          autoFocus
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
          }}
          placeholder="e.g., 0123456789 or BURG-001"
          className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none font-mono"
        />
        <div className="flex gap-3 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => value.trim() && onSubmit(value.trim())}
            disabled={!value.trim()}
            className="flex-1 py-2 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-40"
          >
            Look Up
          </button>
        </div>
      </div>
    </div>
  );
}
