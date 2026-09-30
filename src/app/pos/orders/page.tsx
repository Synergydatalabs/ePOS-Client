"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@iconify/react";
import { toast } from "sonner";
import ProductCard from "@/components/pos/ProductCard";
import CartPanel from "@/components/pos/CartPanel";
import ProductModal from "@/components/pos/ProductModal";
import PaymentModal from "@/components/pos/PaymentModal";
import OrderTypeModal, { OrderTypeSelection } from "@/components/pos/OrderTypeModal";
import TerminalStatusIndicator from "@/components/pos/TerminalStatusIndicator";
import TechnicianSelector from "@/components/pos/TechnicianSelector";
import TimeSlotPicker from "@/components/pos/TimeSlotPicker";
import { useTerminal } from "@/hooks/useTerminal";
import { useBarcodeScanner } from "@/hooks/useBarcodeScanner";
import CashDrawerModal from "@/components/pos/CashDrawerModal";
import TimeClockModal from "@/components/pos/TimeClockModal";
import DiscountModal, { DiscountApplied } from "@/components/pos/DiscountModal";
import CustomerModal, { AttachedCustomer } from "@/components/pos/CustomerModal";
import BillSplitModal from "@/components/pos/BillSplitModal";
import { usePartnerBranding } from "@/lib/use-partner-branding";
import Link from "next/link";

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
  durationMinutes?: number;
  requiresTechnician?: boolean;
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
  // Restaurant dine-in: which seat at the table this item belongs to.
  // Optional everywhere else; defaults to 1 when unset.
  seat?: number;
  // Salon fields
  technicianId?: string;
  technicianName?: string;
  durationMinutes?: number;
  scheduledStart?: string;
  scheduledEnd?: string;
}

interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role: string;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  currency: string;
  businessType?: string;
}

export default function POSOrdersPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);

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
  const [tableNumber, setTableNumber] = useState<string | undefined>();
  // Restaurant DINE_IN only — how many seats are at this table. Drives the
  // per-item seat picker in CartPanel; cleared between orders.
  const [numberOfSeats, setNumberOfSeats] = useState<number>(1);

  const handleChangeNumberOfSeats = useCallback((n: number) => {
    const clamped = Math.max(1, Math.min(9, Math.round(n)));
    setNumberOfSeats(clamped);
    // When the operator shrinks the seat count, any item assigned to a
    // now-out-of-range seat falls back to seat 1 so the cart stays valid.
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

  // Optional customer details captured by the OrderTypeModal
  const [customerName, setCustomerName] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState<string>("");
  const [customerAddress, setCustomerAddress] = useState<string>("");
  // Order-type modal state — mandatory confirmation before restaurant orders
  const [showOrderTypeModal, setShowOrderTypeModal] = useState(false);
  const [orderTypeConfirmed, setOrderTypeConfirmed] = useState(false);

  const handleOrderTypeConfirm = (selection: OrderTypeSelection) => {
    // Cast because modal only emits DINE_IN/TAKEAWAY/DELIVERY; APPOINTMENT
    // is set separately by the salon flow.
    setOrderType(selection.orderType as "DINE_IN" | "TAKEAWAY" | "DELIVERY");
    setTableNumber(selection.tableId);
    setNumberOfSeats(selection.numberOfSeats || 1);
    setCustomerName(selection.customerName || "");
    setCustomerPhone(selection.customerPhone || "");
    setCustomerAddress(selection.customerAddress || "");
    setOrderTypeConfirmed(true);
    setShowOrderTypeModal(false);
  };

  const handleOrderTypeModalClose = () => {
    setShowOrderTypeModal(false);
    if (!orderTypeConfirmed) {
      // Fallback to Takeaway so the cart is still usable if they close
      // the modal by mistake — they can re-open via the pill or "New Order".
      setOrderType("TAKEAWAY");
      setOrderTypeConfirmed(true);
    }
  };

  // Modal state
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);

  // Salon appointment state
  const [technicianModalOpen, setTechnicianModalOpen] = useState(false);
  const [scanFlash, setScanFlash] = useState<null | "hit" | "miss">(null);
  const [manualScanOpen, setManualScanOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [clockOpen, setClockOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discount, setDiscount] = useState<DiscountApplied | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customer, setCustomer] = useState<AttachedCustomer | null>(null);
  const [billSplitOrderId, setBillSplitOrderId] = useState<string | null>(null);
  const [timeSlotModalOpen, setTimeSlotModalOpen] = useState(false);
  const [pendingSalonItem, setPendingSalonItem] = useState<CartItem | null>(null);
  const [appointmentDate, setAppointmentDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [appointmentTime, setAppointmentTime] = useState<string | null>(null);

  // Settings
  const [settings, setSettings] = useState<any>(null);
  const [currency, setCurrency] = useState("CAD");

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

  // Tenant brand colour — feeds into PaymentModal so the modal's
  // accents (tip-button background, tip total summary, etc.) match the
  // partner's brand instead of the template's hardcoded teal.
  // Resolves from the current hostname via /api/partner/branding.
  const { branding } = usePartnerBranding();

  // Check POS session on mount
  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
    try {
      const response = await fetch("/api/pos/auth/session");
      const data = await response.json();

      if (!data.authenticated) {
        router.replace("/pos/login");
        return;
      }

      if (data.mustChangePassword) {
        router.replace("/pos/login?changePassword=true");
        return;
      }

      setUser(data.user);
      setTenant(data.tenant);
      setTenantId(data.tenant.id);
      setCurrency(data.tenant.currency || "CAD");

      // Store for other uses
      localStorage.setItem("tap_active_tenant", data.tenant.id);
      if (data.tenant.businessType) {
        localStorage.setItem("tap_business_type", data.tenant.businessType);
      }

      // Get location from localStorage or use first one
      const storedLocation = localStorage.getItem("tap_active_location");
      if (storedLocation) {
        setLocationId(storedLocation);
      }

      setAuthChecked(true);
    } catch (error) {
      console.error("Session check failed:", error);
      router.replace("/pos/login");
    }
  };

  // Load categories and products
  const loadData = useCallback(async () => {
    if (!tenantId) return;

    setLoading(true);
    try {
      // Always fetch locations first if not set
      let currentLocationId = locationId;
      if (!currentLocationId) {
        const locRes = await fetch(`/api/tenants/${tenantId}/locations`);
        const locData = await locRes.json();
        if (locData.success && locData.locations?.length > 0) {
          currentLocationId = locData.locations[0].id;
          setLocationId(currentLocationId);
          localStorage.setItem("tap_active_location", currentLocationId);
        }
      }

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
      }
    } catch (error) {
      console.error("Failed to load data:", error);
      toast.error("Failed to load menu");
    } finally {
      setLoading(false);
    }
  }, [tenantId, locationId]);

  useEffect(() => {
    if (authChecked && tenantId) {
      loadData();
    }
  }, [authChecked, tenantId, loadData]);

  // Auto-open the order-type modal for restaurants once we know the
  // tenant's business type. Salon (Appointment) and retail (Sale) don't
  // need the popup — their order type is implicit.
  useEffect(() => {
    if (tenant?.businessType === "restaurant" && !orderTypeConfirmed) {
      setShowOrderTypeModal(true);
    }
  }, [tenant?.businessType, orderTypeConfirmed]);

  // Filter products
  const filteredProducts = products.filter((product) => {
    const matchesCategory = !selectedCategory || product.category?.id === selectedCategory;
    const matchesSearch =
      !searchQuery ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  // Calculate totals — discount applies before tax so we don't charge
  // sales tax on the discounted portion.
  const subtotal = cart.reduce(
    (sum, item) => sum + (item.unitPrice + item.modifiersTotal) * item.quantity,
    0
  );
  const discountAmount = discount ? Math.min(discount.amount, subtotal) : 0;
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

  useBarcodeScanner({
    onScan: lookupAndAdd,
    enabled:
      !!tenantId &&
      orderTypeConfirmed &&
      !paymentModalOpen &&
      !productModalOpen &&
      !technicianModalOpen &&
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
    setNumberOfSeats(1);
    setDiscount(null);
    setCustomer(null);
    toast.info("Cart cleared");
  };

  const isSalon = tenant?.businessType === "salon";
  const isRetail = tenant?.businessType === "retail";

  const handleProductClick = (product: Product) => {
    if (
      (product.variants && product.variants.length > 0) ||
      (product.productModifierGroups && product.productModifierGroups.length > 0) ||
      (product.productAllergens && product.productAllergens.length > 0)
    ) {
      setSelectedProduct(product);
      setProductModalOpen(true);
    } else if (isSalon && product.requiresTechnician) {
      // For salon services requiring technician, show technician selector
      const unitPrice = product.basePrice;
      const newItem: CartItem = {
        id: `${Date.now()}-${Math.random()}`,
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice,
        modifiersTotal: 0,
        durationMinutes: product.durationMinutes,
      };
      setPendingSalonItem(newItem);
      setTechnicianModalOpen(true);
    } else {
      handleAddToCart({
        productId: product.id,
        quantity: 1,
        modifiers: [],
      });
    }
  };

  const handleTechnicianSelect = (technician: { id: string; firstName?: string; lastName?: string }) => {
    if (!pendingSalonItem) return;
    const techName = technician.firstName
      ? `${technician.firstName}${technician.lastName ? ` ${technician.lastName}` : ""}`
      : "Any Available";
    setPendingSalonItem({
      ...pendingSalonItem,
      technicianId: technician.id || undefined,
      technicianName: techName,
    });
    setTechnicianModalOpen(false);
    // Now show time slot picker
    setTimeSlotModalOpen(true);
  };

  const handleTimeSlotSelect = (time: string) => {
    if (!pendingSalonItem) return;
    const duration = pendingSalonItem.durationMinutes || 30;
    const [h, m] = time.split(":").map(Number);
    const start = new Date(`${appointmentDate}T${time}:00`);
    const end = new Date(start.getTime() + duration * 60000);
    const endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;

    const finalItem: CartItem = {
      ...pendingSalonItem,
      scheduledStart: `${appointmentDate}T${time}:00`,
      scheduledEnd: `${appointmentDate}T${endTime}:00`,
    };
    setCart((prev) => [...prev, finalItem]);
    setAppointmentTime(time);
    setOrderType("APPOINTMENT");
    setPendingSalonItem(null);
    setTimeSlotModalOpen(false);
    toast.success(`Added ${finalItem.productName} to cart`);
  };

  const handleCheckout = () => {
    if (cart.length === 0) return;
    setPaymentModalOpen(true);
  };

  const handlePayment = async (
    method: string,
    amount?: number,
    extras?: {
      code?: string;
      orderId?: string;
      surchargeAmount?: number;
      cashDiscountAmount?: number;
      cashDiscountReason?: string;
    }
  ) => {
    if (!tenantId || !locationId) {
      toast.error("Location not set");
      return { success: false };
    }

    try {
      // Split-tender: reuse the order created on the first tender.
      let orderData: any;
      if (extras?.orderId) {
        orderData = {
          success: true,
          order: { id: extras.orderId, orderNumber: "" },
        };
      } else {
        const orderItems = cart.map((item) => ({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          modifiers: item.modifiers?.map((m) => ({ modifierId: m.name, quantity: 1 })),
          specialInstructions: item.specialInstructions,
          allergyNotes: item.allergyNotes,
          // Salon fields
          technicianId: item.technicianId,
          scheduledStart: item.scheduledStart,
          scheduledEnd: item.scheduledEnd,
        }));

        const orderPayload: any = {
          locationId,
          orderType,
          tableId: orderType === "DINE_IN" ? tableNumber : undefined,
          items: orderItems,
          // Merge line-level discount with cash-discount when paying in cash
          discountAmount: (discountAmount || 0) + (extras?.cashDiscountAmount || 0),
          promotionId: discount?.promotionId,
          discountCode: discount?.code,
          discountReason: [discount?.reason, extras?.cashDiscountReason]
            .filter(Boolean)
            .join(" · ") || undefined,
          surchargeAmount: extras?.surchargeAmount || 0,
          // Attached customer wins over the OrderTypeModal-captured
          // customerName / phone / address so we don't overwrite a
          // profile's details with a walk-in name typed at OT time.
          customerName: customer
            ? `${customer.firstName}${customer.lastName ? " " + customer.lastName : ""}`
            : undefined,
          customerPhone: customer?.phone || undefined,
          customerEmail: customer?.email || undefined,
        };

        // Add appointment fields for salon orders
        if (orderType === "APPOINTMENT") {
          orderPayload.appointmentDate = appointmentDate;
          orderPayload.appointmentTime = appointmentTime;
        }

        const orderRes = await fetch(`/api/tenants/${tenantId}/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderPayload),
        });

        orderData = await orderRes.json();

        if (!orderData.success) {
          toast.error("Failed to create order");
          return { success: false };
        }
      }

      // For TERMINAL_INTENT: just create the order, skip server-side payment.
      // The browser will handle terminal communication directly.
      if (method === "TERMINAL_INTENT") {
        return {
          success: true,
          orderId: orderData.order.id,
          orderNumber: orderData.order.orderNumber,
        };
      }

      // Gift card — redeem against the newly-created order. Partial
      // redemptions leave the order paymentStatus non-COMPLETED so the
      // operator can re-open PaymentModal for the remaining balance.
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
        if (method === "ONLINE") {
          toast.success("QR Code generated - present to customer");
          return {
            success: true,
            qrCode: paymentData.paymentUrl || paymentData.qrPayload,
            orderId: orderData.order.id,
            orderNumber: orderData.order.orderNumber,
          };
        }

        // Only reset the POS to a fresh-order state once the whole order
        // is paid off — split-tender payments come back with remaining > 0
        // until the last tender.
        const fullyPaid = (paymentData.remaining ?? 0) <= 0;
        if (fullyPaid) {
          setCart([]);
          setNumberOfSeats(1);
          setCustomerName("");
          setCustomerPhone("");
          setCustomerAddress("");
          setDiscount(null);
          setCustomer(null);
          if (tenant?.businessType === "restaurant") {
            setOrderTypeConfirmed(false);
          }
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
          cardDetails: paymentData.cardDetails,
        };
      }

      // Terminal declined or error
      if (paymentData.error) {
        return {
          success: false,
          error: paymentData.error,
          errorType: paymentData.errorType,
          orderId: orderData.order.id,
          terminalTxId: paymentData.terminalTxId,
        };
      }

      return { success: false };
    } catch (error) {
      console.error("Payment error:", error);
      toast.error("Payment failed");
      return { success: false };
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/pos/auth/logout", { method: "POST" });
      router.replace("/pos/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency,
    }).format(amount / 100);
  };

  // Loading state
  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent mx-auto mb-4" />
          <p className="text-gray-600">Loading POS...</p>
        </div>
      </div>
    );
  }

  const userName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : user?.email.split('@')[0] || 'Staff';

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Top Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/pos" className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
            <Icon icon="solar:arrow-left-linear" className="w-5 h-5" />
          </Link>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
            <Icon icon="solar:bag-4-bold" className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-sm">{tenant?.name}</h1>
            <p className="text-xs text-gray-500">{isSalon ? "New Appointment" : "New Order"}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {tenantId && <TerminalStatusIndicator tenantId={tenantId} />}
          <span className="text-sm text-gray-600">{userName}</span>
          <button
            onClick={handleLogout}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-red-500 transition-colors"
            title="Logout"
          >
            <Icon icon="solar:logout-2-outline" className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Order-type pill row — restaurant only.
          Shows current type (Dine In / Takeaway / Delivery) as a clickable
          pill; "New Order" button clears cart + reopens the modal fresh. */}
      {tenant?.businessType === "restaurant" && orderTypeConfirmed && (
        <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setShowOrderTypeModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-50 text-teal-700 hover:bg-teal-100 font-semibold text-sm transition-colors"
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
            <Icon icon="solar:pen-2-linear" className="w-4 h-4 ml-1 opacity-60" />
          </button>
          <button
            onClick={() => {
              if (
                cart.length > 0 &&
                !confirm("Clear current cart and start a brand new order?")
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
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 font-semibold text-sm transition-colors flex items-center gap-2"
            title="Start a new order"
          >
            <Icon icon="solar:add-circle-bold" className="w-5 h-5" />
            New Order
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Main Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search & Categories */}
          <div className="bg-white border-b border-gray-200 px-4 py-3">
            <div className="flex items-center gap-4">
              <div className="flex-1 max-w-md relative">
                <Icon
                  icon="solar:magnifer-linear"
                  className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
                />
                <input
                  type="text"
                  placeholder={isSalon ? "Search services..." : "Search products..."}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none text-gray-900"
                />
              </div>
              {/* Scanner controls — hidden on salon since services aren't scanned */}
              {!isSalon && (
                <div className="flex items-center gap-2">
                  <div
                    className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
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
                      className="w-3.5 h-3.5"
                    />
                    <span>
                      {scanFlash === "hit"
                        ? "Scanned"
                        : scanFlash === "miss"
                          ? "No match"
                          : "Scanner ready"}
                    </span>
                  </div>
                  <button
                    onClick={() => setManualScanOpen(true)}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 transition-colors"
                    title="Enter barcode manually"
                  >
                    <Icon icon="solar:scanner-2-bold" className="w-4 h-4" />
                  </button>
                </div>
              )}
              {/* Cash drawer is useful for salon too (tips etc.) so it lives outside the retail-only block */}
              <button
                onClick={() => setDrawerOpen(true)}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-emerald-400 hover:bg-emerald-50 text-gray-600 hover:text-emerald-600 transition-colors"
                title="Cash drawer"
              >
                <Icon icon="solar:wallet-2-bold" className="w-4 h-4" />
              </button>
              {/* Time clock */}
              <button
                onClick={() => setClockOpen(true)}
                className="px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-purple-400 hover:bg-purple-50 text-gray-600 hover:text-purple-600 transition-colors"
                title="Time clock"
              >
                <Icon icon="solar:clock-circle-bold" className="w-4 h-4" />
              </button>

              <div className="flex-1 flex items-center gap-2 overflow-x-auto">
                <button
                  onClick={() => setSelectedCategory(null)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    !selectedCategory
                      ? "bg-indigo-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                      selectedCategory === cat.id
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {cat.name}
                  </button>
                ))}
              </div>
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
                <p className="text-lg font-medium">{isSalon ? "No services found" : "No products found"}</p>
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
                    durationMinutes={isSalon ? product.durationMinutes : undefined}
                    currency={currency}
                    onClick={() => handleProductClick(product)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Mobile Cart Summary */}
          <div className="lg:hidden border-t border-gray-200 bg-white p-4">
            <button
              onClick={handleCheckout}
              disabled={cart.length === 0}
              className="w-full py-3 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between px-4"
            >
              <span>
                {cart.length} item{cart.length !== 1 ? "s" : ""}
              </span>
              <span className="font-bold">{formatPrice(total)}</span>
              <Icon icon="solar:arrow-right-linear" className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Cart Panel */}
        <div className="hidden lg:block w-96 border-l border-gray-200">
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
            businessType={tenant?.businessType}
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
                : undefined
            }
            customerSubline={
              customer
                ? [customer.phone, customer.email].filter(Boolean).join(" · ") ||
                  undefined
                : undefined
            }
            onOpenCustomer={() => setCustomerOpen(true)}
            onRemoveCustomer={() => setCustomer(null)}
          />
        </div>
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
          orderType === "DINE_IN"
            ? async () => {
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
        brandColor={branding.brandPrimaryColor}
        onPayment={handlePayment}
        onPaymentComplete={() => {
          setCart([]);
          setNumberOfSeats(1);
          setCustomerName("");
          setCustomerPhone("");
          setCustomerAddress("");
          // Force the order-type modal to reopen for the next order so the
          // cashier explicitly confirms Dine In / Takeaway / Delivery again.
          if (tenant?.businessType === "restaurant") {
            setOrderTypeConfirmed(false);
          }
        }}
        tenantId={tenantId || undefined}
        locationId={locationId || undefined}
        // Browser-side terminal props
        terminalConnected={terminalOnline}
        terminalName={activeTerminal?.name}
        onTerminalPayment={(params) =>
          terminalProcessPayment({
            ...params,
            // Surface the cart's seat assignment to the bill API so the
            // CREATE_ORDER request carries multi-item-per-seat structure
            // (resolves GP cert "one item per seat" finding on restaurant
            // orders built from the POS).
            lineItemsOverride: cart.map((item) => {
              const unit = item.unitPrice + item.modifiersTotal;
              return {
                name:
                  item.productName +
                  (item.variantName ? ` (${item.variantName})` : ""),
                quantity: item.quantity,
                unitPrice: unit,
                lineTotal: unit * item.quantity,
                seat: Math.max(1, Math.min(numberOfSeats, item.seat ?? 1)),
              };
            }),
          })
        }
        onTerminalCancel={terminalCancel}
        onTerminalRecover={terminalRecover}
        terminalPaymentState={terminalPaymentState}
        terminalResult={terminalResult}
        onResetTerminal={terminalReset}
      />

      {/* Salon: Technician Selector */}
      {technicianModalOpen && tenantId && pendingSalonItem && (
        <TechnicianSelector
          tenantId={tenantId}
          productId={pendingSalonItem.productId}
          onSelect={handleTechnicianSelect}
          onClose={() => {
            setTechnicianModalOpen(false);
            setPendingSalonItem(null);
          }}
        />
      )}

      {/* Salon: Time Slot Picker */}
      {timeSlotModalOpen && tenantId && pendingSalonItem && (
        <TimeSlotPicker
          tenantId={tenantId}
          technicianId={pendingSalonItem.technicianId}
          durationMinutes={pendingSalonItem.durationMinutes || 30}
          date={appointmentDate}
          onSelect={handleTimeSlotSelect}
          onClose={() => {
            setTimeSlotModalOpen(false);
            setPendingSalonItem(null);
          }}
          onDateChange={(d) => setAppointmentDate(d)}
        />
      )}

      {/* Order-type modal — mandatory for restaurants at start of each order */}
      <OrderTypeModal
        isOpen={showOrderTypeModal}
        onClose={handleOrderTypeModalClose}
        onConfirm={handleOrderTypeConfirm}
        tenantId={tenantId}
        locationId={locationId}
        currentType={
          orderTypeConfirmed && orderType !== "APPOINTMENT"
            ? (orderType as "DINE_IN" | "TAKEAWAY" | "DELIVERY")
            : undefined
        }
        currentTableId={
          orderTypeConfirmed && orderType === "DINE_IN" ? tableNumber : undefined
        }
        currentSeats={numberOfSeats}
        hasCartItems={cart.length > 0}
        brandColor={branding.brandPrimaryColor}
      />

      {/* Manual barcode entry */}
      {manualScanOpen && (
        <ManualBarcodeModal
          onClose={() => setManualScanOpen(false)}
          onSubmit={(code) => {
            setManualScanOpen(false);
            lookupAndAdd(code);
          }}
        />
      )}

      {/* Cash drawer */}
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

      {/* Discount */}
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

      {/* Customer */}
      {customerOpen && tenantId && (
        <CustomerModal
          isOpen={customerOpen}
          onClose={() => setCustomerOpen(false)}
          tenantId={tenantId}
          currency={currency}
          onAttach={(c) => setCustomer(c)}
        />
      )}

      {/* Bill split — dine-in only, opens after order is created */}
      {billSplitOrderId && tenantId && (
        <BillSplitModal
          isOpen={true}
          onClose={() => setBillSplitOrderId(null)}
          tenantId={tenantId}
          orderId={billSplitOrderId}
          orderTotal={total}
          currency={currency}
          onAllPaid={() => {
            setCart([]);
            setNumberOfSeats(1);
            setCustomerName("");
            setCustomerPhone("");
            setCustomerAddress("");
            setDiscount(null);
            setCustomer(null);
            setBillSplitOrderId(null);
            if (tenant?.businessType === "restaurant") {
              setOrderTypeConfirmed(false);
            }
            toast.success("Order fully paid via split");
          }}
        />
      )}
    </div>
  );
}

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
