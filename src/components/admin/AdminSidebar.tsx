"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@iconify/react";
import { useT } from "@/lib/i18n/context";
import UserProfileDrawer from "@/components/shared/UserProfileDrawer";

// Map from the human-readable English labels used in getNavItems() to
// dictionary keys. Kept out of getNavItems so we don't have to rewrite
// every business-type branch — labels that don't have a mapping just
// stay English (fallback via defaultValue on the render side).
const NAV_LABEL_KEYS: Record<string, string> = {
  Dashboard: "nav.dashboard",
  Orders: "nav.orders",
  POS: "nav.pos",
  Menu: "nav.menu",
  Products: "nav.products",
  Categories: "nav.categories",
  Modifiers: "nav.modifiers",
  Allergens: "nav.allergens",
  Inventory: "nav.inventory",
  Marketplace: "nav.marketplace",
  Customers: "nav.customers",
  Reservations: "nav.reservations",
  Waitlist: "nav.waitlist",
  "Floor Plan": "nav.floor_plan",
  Team: "nav.team",
  Settings: "nav.settings",
  Reports: "nav.reports",
  Sales: "nav.sales_report",
  "Product Performance": "nav.product_performance",
  "Sales Tax": "nav.sales_tax_report",
  "Form 8027 (US Tips)": "nav.form_8027",
  "T4 Controlled Tips (Canada)": "nav.t4_controlled_tips",
  "Cash Drawer": "nav.cash_drawer",
  Loyalty: "nav.loyalty",
  Promotions: "nav.promotions",
  Tax: "nav.tax",
  Timesheet: "nav.timesheet",
  "Tip Pools": "nav.tip_pools",
  Payments: "nav.payments",
  Terminals: "nav.terminals",
  Transactions: "nav.transactions",
  "Payment Links": "nav.payment_links",
  "Gift Cards": "nav.gift_cards",
  Integrations: "nav.integrations",
  Kitchen: "nav.kitchen",
  Stations: "nav.stations",
  Displays: "nav.displays",
  Support: "nav.support",
};

interface NavItem {
  label: string;
  href: string;
  icon: string;
  badge?: number;
  /** Small text chip rendered next to the label — e.g. "Draft" / "In review"
   *  for onboarding, so the owner can see application progress without
   *  clicking through. */
  chip?: { text: string; tone: "gray" | "amber" | "indigo" | "emerald" | "red" };
  /** Only render this item when the caller passes this specific role.
   *  Used for TENANT_OWNER-only entries like Payment Onboarding. */
  ownerOnly?: boolean;
  children?: { label: string; href: string }[];
}

function getNavItems(
  businessType?: string,
  onboardingChip?: NavItem["chip"]
): NavItem[] {
  const isSalon = businessType === "salon";
  const isRetail = businessType === "retail";
  const isCab = businessType === "cab";
  const isRestaurant = !isSalon && !isRetail && !isCab;

  // Cab / transport business type — completely different nav
  if (isCab) {
    return [
      { label: "Dashboard", href: "/dashboard/admin", icon: "solar:home-2-bold" },
      { label: "Dispatch", href: "/dashboard/admin/dispatch", icon: "solar:radar-2-bold" },
      { label: "Trips", href: "/dashboard/admin/trips", icon: "solar:route-bold" },
      { label: "Drivers", href: "/dashboard/admin/drivers", icon: "solar:user-id-bold" },
      { label: "Vehicles", href: "/dashboard/admin/vehicles", icon: "solar:car-bold" },
      { label: "Zones", href: "/dashboard/admin/zones", icon: "solar:map-bold" },
      { label: "Fares", href: "/dashboard/admin/fares", icon: "solar:tag-price-bold" },
      { label: "Promos", href: "/dashboard/admin/promos", icon: "solar:ticket-bold" },
      {
        label: "Payments",
        href: "/dashboard/admin/terminals",
        icon: "solar:card-transfer-bold",
        children: [
          { label: "Terminals", href: "/dashboard/admin/terminals" },
          { label: "Transactions", href: "/dashboard/admin/transactions" },
        ],
      },
      {
        label: "Reports",
        href: "/dashboard/admin/reports",
        icon: "solar:chart-2-bold",
        children: [
          { label: "Sales", href: "/dashboard/admin/reports/sales" },
          { label: "Product Performance", href: "/dashboard/admin/reports/product-performance" },
        ],
      },
      { label: "Support", href: "/dashboard/admin/support", icon: "solar:chat-round-dots-bold" },
      { label: "Team", href: "/dashboard/admin/team", icon: "solar:users-group-two-rounded-bold" },
      { label: "Settings", href: "/dashboard/admin/settings", icon: "solar:settings-bold" },
    ];
  }

  // Label helpers
  const catalogLabel = isSalon ? "Services" : isRetail ? "Products" : "Menu";
  const catalogIcon = isSalon ? "solar:scissors-bold" : isRetail ? "solar:bag-heart-bold" : "solar:notebook-bold";
  const ordersLabel = isSalon ? "Appointments" : "Orders";
  const ordersIcon = isSalon ? "solar:calendar-bold" : "solar:clipboard-list-bold";

  const items: NavItem[] = [
    { label: "Dashboard", href: "/dashboard/admin", icon: "solar:home-2-bold" },
    { label: ordersLabel, href: "/dashboard/admin/orders", icon: ordersIcon, badge: 0 },
    {
      label: catalogLabel,
      href: "/dashboard/admin/menu",
      icon: catalogIcon,
      children: [
        { label: isSalon ? "Service Types" : "Categories", href: "/dashboard/admin/menu/categories" },
        { label: isSalon ? "Services" : "Products", href: "/dashboard/admin/menu/products" },
        { label: isSalon ? "Add-ons" : isRetail ? "Variants" : "Modifiers", href: "/dashboard/admin/menu/modifiers" },
        ...(isRestaurant ? [{ label: "Allergens", href: "/dashboard/admin/menu/allergens" }] : []),
      ],
    },
  ];

  // Inventory — restaurant and retail (retail stores need inventory!)
  if (isRestaurant || isRetail) {
    items.push({
      label: "Inventory",
      href: "/dashboard/admin/inventory",
      icon: "solar:box-bold",
      children: isRetail
        ? [
            { label: "Stock Levels", href: "/dashboard/admin/inventory/stock" },
            { label: "Suppliers", href: "/dashboard/admin/inventory/suppliers" },
          ]
        : [
            { label: "Ingredients", href: "/dashboard/admin/inventory/ingredients" },
            { label: "Stock Levels", href: "/dashboard/admin/inventory/stock" },
            { label: "Suppliers", href: "/dashboard/admin/inventory/suppliers" },
          ],
    });

    // Phase B (2026-07-30): supplier marketplace. Available to any business
    // type that keeps inventory (restaurant + retail today; salons and cabs
    // rarely order stock through a marketplace). Children so merchants can
    // hop directly to their purchase-order inbox without going through the
    // marketplace index every time.
    items.push({
      label: "Marketplace",
      href: "/dashboard/admin/marketplace",
      icon: "solar:shop-2-bold",
      children: [
        { label: "Browse Suppliers", href: "/dashboard/admin/marketplace" },
        { label: "Purchase Orders", href: "/dashboard/admin/marketplace/orders" },
      ],
    });
  }

  // Tables — restaurant only
  if (isRestaurant) {
    items.push({
      label: "Tables",
      href: "/dashboard/admin/tables",
      icon: "solar:sofa-2-bold",
      children: [
        { label: "Tables list", href: "/dashboard/admin/tables" },
        { label: "Floor plan (edit)", href: "/dashboard/admin/floor-plan" },
        { label: "Live floor view", href: "/dashboard/pos/floor-view" },
      ],
    });
    // Phase 3b: restaurant media gallery (photos, videos, 360° panoramas)
    items.push({
      label: "Media Gallery",
      href: "/dashboard/admin/restaurant-media",
      icon: "solar:gallery-bold",
    });
    // Phase 3c: virtual tour editor (link 360° panoramas with hotspots)
    items.push({
      label: "Virtual Tour",
      href: "/dashboard/admin/virtual-tour",
      icon: "solar:eye-bold",
    });
    // Phase 5a: reservations (list + calendar + 3-tap create)
    // Phase 5b: + waitlist + special dates submenus
    items.push({
      label: "Reservations",
      href: "/dashboard/admin/reservations",
      icon: "solar:calendar-bold",
      children: [
        { label: "Reservations", href: "/dashboard/admin/reservations" },
        { label: "Waitlist (walk-ins)", href: "/dashboard/admin/waitlist" },
        { label: "Special dates", href: "/dashboard/admin/special-dates" },
      ],
    });
  }

  // Phase 5d: integrations (WhatsApp BYO, Google Business, etc.) — all biz types
  items.push({
    label: "Integrations",
    href: "/dashboard/admin/integrations",
    icon: "solar:link-bold",
    children: [
      { label: "All integrations", href: "/dashboard/admin/integrations" },
      { label: "WhatsApp Business", href: "/dashboard/admin/integrations/whatsapp" },
      { label: "SMS", href: "/dashboard/admin/integrations/sms" },
      { label: "Google Business", href: "/dashboard/admin/integrations/google-business" },
      { label: "QuickBooks", href: "/dashboard/admin/integrations/quickbooks" },
      { label: "Deliverect (delivery)", href: "/dashboard/admin/integrations/deliverect" },
    ],
  });

  // Loyalty — all business types (rewards, points, streaks)
  items.push({
    label: "Loyalty",
    href: "/dashboard/admin/loyalty",
    icon: "solar:medal-star-bold",
  });

  // Promotions — promo codes + auto-apply discounts
  items.push({
    label: "Promotions",
    href: "/dashboard/admin/promotions",
    icon: "solar:ticket-bold",
  });

  // Tax — categories + per-location overrides
  items.push({
    label: "Tax",
    href: "/dashboard/admin/tax",
    icon: "solar:tag-linear",
  });

  // Timesheet — staff hours + shifts for payroll
  items.push({
    label: "Timesheet",
    href: "/dashboard/admin/timesheet",
    icon: "solar:clock-circle-bold",
  });

  // Tip Pools — pool + redistribute end-of-shift tips
  items.push({
    label: "Tip Pools",
    href: "/dashboard/admin/tip-pools",
    icon: "solar:hand-money-bold",
  });

  // Payments — all business types
  items.push({
    label: "Payments",
    href: "/dashboard/admin/terminals",
    icon: "solar:card-transfer-bold",
    children: [
      { label: "Terminals", href: "/dashboard/admin/terminals" },
      { label: "Transactions", href: "/dashboard/admin/transactions" },
      { label: "Payment Links", href: "/dashboard/admin/payment-links" },
      { label: "Gift Cards", href: "/dashboard/admin/gift-cards" },
    ],
  });

  // Kitchen — restaurant only
  if (isRestaurant) {
    items.push({
      label: "Kitchen",
      href: "/dashboard/admin/stations",
      icon: "solar:chef-hat-bold",
      children: [
        { label: "Stations", href: "/dashboard/admin/stations" },
        { label: "Display", href: "/dashboard/kitchen" },
      ],
    });
  }

  // Displays — restaurant & salon (iPad/TV screens)
  if (isRestaurant || isSalon) {
    items.push({
      label: "Displays",
      href: "/dashboard/admin/displays",
      icon: "solar:monitor-smartphone-bold",
    });
  }

  items.push({
    label: "Reports",
    href: "/dashboard/admin/reports",
    icon: "solar:chart-2-bold",
    children: [
      { label: "Sales", href: "/dashboard/admin/reports/sales" },
      { label: "Product Performance", href: "/dashboard/admin/reports/product-performance" },
      { label: "Cash Drawer", href: "/dashboard/admin/cash-drawer" },
      { label: "Sales Tax", href: "/dashboard/admin/reports/sales-tax" },
      { label: "Form 8027 (US Tips)", href: "/dashboard/admin/reports/form-8027" },
      { label: "T4 Controlled Tips (Canada)", href: "/dashboard/admin/reports/t4-controlled-tips" },
      ...(!isSalon ? [{ label: "Inventory", href: "/dashboard/admin/reports/inventory" }] : []),
    ],
  });

  items.push(
    { label: "Team", href: "/dashboard/admin/team", icon: "solar:users-group-two-rounded-bold" },
    // Phase 2c (2026-08): payment onboarding wizard. TENANT_OWNER only —
    // the AdminSidebar filters by ownerOnly at render time. Chip surfaces
    // draft / in-review state without a click-through.
    {
      label: "Payment Onboarding",
      href: "/dashboard/admin/onboarding",
      icon: "solar:card-2-bold",
      ownerOnly: true,
      chip: onboardingChip,
    },
    { label: "Settings", href: "/dashboard/admin/settings", icon: "solar:settings-bold" },
  );

  return items;
}

interface AdminSidebarProps {
  tenantName?: string;
  /** PHASE 7a (2026-05-18): partner logo URL — shows instead of the
   *  generic shop icon when a partner has uploaded their own brand. */
  tenantLogoUrl?: string | null;
  businessType?: string;
  /** PHASE 2c (2026-08): current membership role. Used to hide
   *  ownerOnly nav entries (like Payment Onboarding). */
  userRole?: string | null;
  /** PHASE 2c (2026-08): current MerchantApplication status for this
   *  tenant. Renders a chip on the Onboarding link so owners can see
   *  DRAFT / IN_REVIEW / SUBMITTED at a glance. */
  onboardingStatus?: string | null;
  collapsed?: boolean;
  onToggle?: () => void;
}

// Turn a raw MerchantApplication.status into the small chip the sidebar
// renders. Kept out of the component so a future backfill can call it
// from anywhere.
function statusChip(status?: string | null): NavItem["chip"] | undefined {
  if (!status) return undefined;
  switch (status) {
    case "DRAFT":
      return { text: "Draft", tone: "gray" };
    case "INFO_REQUESTED":
      return { text: "Info needed", tone: "amber" };
    case "SUBMITTED":
    case "IN_REVIEW":
    case "FORWARDED":
    case "PROVIDER_APPROVED":
      return { text: "In review", tone: "indigo" };
    case "APPROVED":
    case "LIVE":
      return { text: "Live", tone: "emerald" };
    case "REJECTED":
      return { text: "Rejected", tone: "red" };
    default:
      return undefined;
  }
}

const CHIP_STYLES: Record<
  NonNullable<NavItem["chip"]>["tone"],
  string
> = {
  gray: "bg-gray-100 text-gray-700",
  amber: "bg-amber-100 text-amber-900",
  indigo: "bg-indigo-100 text-indigo-800",
  emerald: "bg-emerald-100 text-emerald-800",
  red: "bg-red-100 text-red-800",
};

export default function AdminSidebar({
  tenantName,
  tenantLogoUrl,
  businessType,
  userRole,
  onboardingStatus,
  collapsed,
  onToggle,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [signingOut, setSigningOut] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { t } = useT();
  const isOwner = userRole === "TENANT_OWNER" || userRole === "OWNER";
  const rawItems = getNavItems(businessType, statusChip(onboardingStatus));
  // Filter out ownerOnly entries when the user isn't an owner. We keep the
  // filter here (rather than in getNavItems) so getNavItems doesn't need
  // to grow another parameter for a UI-only concern.
  const navItems = rawItems.filter((n) => !n.ownerOnly || isOwner);

  // Sign-out logic extracted so both the drawer's Sign Out button and the
  // sidebar's Sign Out button run identical behavior. Kept the same
  // hostname-aware redirect that was here before.
  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      document.cookie = "partner_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      localStorage.removeItem("tap_active_tenant");
      localStorage.removeItem("tenantId");
      localStorage.removeItem("partner_user");
      const host = window.location.hostname;
      const isPartnerDomain =
        !host.endsWith("zashx.com") && host !== "localhost" && host !== "127.0.0.1";
      window.location.href = `${window.location.origin}${
        isPartnerDomain ? "/login" : "/partner/login"
      }`;
    } catch {
      setSigningOut(false);
    }
  };

  // Localise a nav label; falls back to the raw English if no dict key
  // is mapped for it (visible in QA, not broken in production).
  const tr = (label: string) =>
    NAV_LABEL_KEYS[label]
      ? t(NAV_LABEL_KEYS[label], { defaultValue: label })
      : label;

  const toggleExpand = (label: string) => {
    setExpandedItems((prev) =>
      prev.includes(label)
        ? prev.filter((l) => l !== label)
        : [...prev, label]
    );
  };

  const isActive = (href: string) => {
    if (href === "/dashboard/admin") {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={`admin-sidebar transition-all duration-300 ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* Logo — PHASE 7a (2026-05-18): show partner logo if provided, else
           fall back to the brand-colored icon tile. `tap-gradient` is the
           default iTap purple; on partner domains it picks up brand colors
           via the `--brand-primary` CSS var set by the admin layout. */}
      <div className="p-4 border-b border-gray-100">
        <Link href="/dashboard/admin" className="flex items-center gap-3">
          {tenantLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={tenantLogoUrl}
              alt={tenantName || "Logo"}
              className="w-10 h-10 rounded-xl object-contain bg-white flex-shrink-0"
            />
          ) : (
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white"
              style={{
                background:
                  "linear-gradient(135deg, var(--brand-primary, #4f46e5), var(--brand-accent, #6366f1))",
              }}
            >
              <Icon icon="solar:shop-2-bold" className="w-6 h-6" />
            </div>
          )}
          {!collapsed && (
            <div className="min-w-0">
              <h1 className="font-bold text-gray-900 truncate">
                {tenantName || "Dashboard"}
              </h1>
              <p className="text-xs text-gray-500">Admin Portal</p>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {navItems.map((item) => {
          const active = isActive(item.href);
          const expanded = expandedItems.includes(item.label);
          const hasChildren = item.children && item.children.length > 0;

          return (
            <div key={item.label}>
              {hasChildren ? (
                <button
                  onClick={() => toggleExpand(item.label)}
                  className={`admin-nav-item w-full justify-between ${
                    active ? "active" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon icon={item.icon} className="w-5 h-5 flex-shrink-0" />
                    {!collapsed && <span>{tr(item.label)}</span>}
                  </div>
                  {!collapsed && (
                    <Icon
                      icon="solar:alt-arrow-down-linear"
                      className={`w-4 h-4 transition-transform ${
                        expanded ? "rotate-180" : ""
                      }`}
                    />
                  )}
                </button>
              ) : (
                <Link
                  href={item.href}
                  className={`admin-nav-item ${active ? "active" : ""}`}
                >
                  <Icon icon={item.icon} className="w-5 h-5 flex-shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="flex-1">{tr(item.label)}</span>
                      {item.chip && (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${CHIP_STYLES[item.chip.tone]}`}
                        >
                          {item.chip.text}
                        </span>
                      )}
                      {item.badge !== undefined && item.badge > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-600 text-xs font-semibold">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              )}

              {/* Children */}
              {hasChildren && expanded && !collapsed && (
                <div className="ml-6 mt-1 space-y-1">
                  {item.children!.map((child) => (
                    <Link
                      key={child.href}
                      href={child.href}
                      className={`block px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        pathname === child.href
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {tr(child.label)}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Quick Actions & Sign Out */}
      {!collapsed && (
        <div className="p-4 border-t border-gray-100 space-y-2">
          <Link
            href={businessType === "cab" ? "/dashboard/admin/dispatch" : "/dashboard/pos"}
            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors"
          >
            <Icon icon={businessType === "cab" ? "solar:radar-2-bold" : businessType === "salon" ? "solar:calendar-bold" : "solar:cart-large-2-bold"} className="w-5 h-5" />
            <span className="font-medium">{businessType === "cab" ? "Open Dispatch" : businessType === "salon" ? "Open Checkout" : businessType === "retail" ? "Open Register" : "Open POS"}</span>
          </Link>
          {/* Combined "your account" tile — opens the profile drawer where
              users edit their name, change password, and sign out. Replaces
              the standalone Sign Out button; consolidates all account
              actions in one place. */}
          <button
            onClick={() => setProfileOpen(true)}
            disabled={signingOut}
            className="flex items-center gap-3 px-4 py-3 rounded-xl w-full text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <Icon icon="solar:user-circle-bold" className="w-5 h-5" />
            <span className="font-medium">{signingOut ? "Signing out..." : "Your Account"}</span>
          </button>
        </div>
      )}

      {/* Collapse Toggle */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center hover:bg-gray-50 transition-colors"
      >
        <Icon
          icon={collapsed ? "solar:arrow-right-linear" : "solar:arrow-left-linear"}
          className="w-4 h-4 text-gray-600"
        />
      </button>

      {/* Shared profile drawer — rendered inside the aside so it inherits
          any layout-scoped CSS but the drawer itself uses `fixed` so it
          overlays the whole viewport. */}
      <UserProfileDrawer
        isOpen={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSignOut={handleSignOut}
      />
    </aside>
  );
}
