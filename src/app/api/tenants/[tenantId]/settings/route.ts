// GET /api/tenants/[tenantId]/settings - Get tenant settings
// PUT /api/tenants/[tenantId]/settings - Update tenant settings

import { NextRequest, NextResponse } from "next/server";
import { validateRequest } from "@/lib/api-middleware";
import prisma from "@/lib/prisma";

// GET - Get tenant settings
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_STAFF");
    if (!validation.success) {
      return validation.response;
    }

    let settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
    });

    // Create default settings if not exist
    if (!settings) {
      settings = await prisma.tenantSettings.create({
        data: {
          tenantId,
          // Tax settings
          taxEnabled: true,
          taxRate: 13,
          taxLabel: "HST",
          tax2Enabled: false,
          tax2Rate: 0,
          tax2Label: "",
          // Tip settings
          tipEnabled: true,
          tipPresets: [15, 18, 20, 25],
          tipCustomEnabled: true,
          // Receipt settings
          receiptHeader: "",
          receiptFooter: "Thank you for your business!",
          // Kitchen settings
          kitchenDisplayEnabled: true,
          kitchenAlertSound: true,
          prepTimeEnabled: true,
          // Display settings
          customerDisplayEnabled: true,
          showOrderDetails: true,
          // Inventory settings
          lowStockAlertEnabled: true,
          autoDeductInventory: true,
          // Order settings
          orderNumberPrefix: "",
          orderNumberReset: "DAILY",
          // Table ordering
          tableOrderingEnabled: true,
          tablePaymentType: "UPFRONT",
          allowGuestOrdering: true,
        },
      });
    }

    // Get tenant info too. `slug` is what the public booking URL card
    // in Settings uses to build `oreugo.ca/book/<slug>/<loc-slug>`.
    // Missing it here was the cause of "Tenant is missing a slug".
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        currency: true,
        timezone: true,
        logoUrl: true,
        businessType: true,
        // Tenant-level gate for public booking. When false, every
        // /api/public/book/* endpoint 404s regardless of the location's
        // own toggle — surface it in the settings UI so the merchant
        // knows why the link is broken.
        publicBookingEnabled: true,
        settings: true,
      },
    });

    return NextResponse.json({
      success: true,
      settings,
      tenant: {
        ...tenant,
        settings,
      },
    });
  } catch (error: any) {
    console.error("[TAP API] Get settings error:", error);
    return NextResponse.json(
      { error: "Failed to get settings" },
      { status: 500 }
    );
  }
}

// PUT - Update tenant settings
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;

    const validation = await validateRequest(request, tenantId, "POS_ADMIN");
    if (!validation.success) {
      return validation.response;
    }

    const rawBody = await request.json();

    // Frontend may send nested `{ name, currency, timezone, settings: {...} }`
    // OR a flat payload — accept both shapes.
    const tenantPatch = {
      name: rawBody.name,
      currency: rawBody.currency,
      timezone: rawBody.timezone,
    };
    const body = { ...(rawBody.settings || {}), ...rawBody };

    const {
      // Tax settings
      taxEnabled,
      taxRate,
      taxLabel,
      tax2Enabled,
      tax2Rate,
      tax2Label,
      // Cash discount / dual pricing
      cashDiscountEnabled,
      cashDiscountPercent,
      cashDiscountMode,
      cashDiscountLabel,
      // Branding — logo shown in the admin sidebar + partner pages.
      // `null` explicitly clears the logo; `undefined` leaves it alone.
      brandLogoUrl,
      // Tip settings (accept both `tipPresets` and older `tipPercentages`/`allowTips`)
      tipEnabled,
      allowTips,
      tipPresets,
      tipPercentages,
      tipCustomEnabled,
      // Receipt settings
      receiptHeader,
      receiptFooter,
      // Kitchen settings
      kitchenDisplayEnabled,
      kitchenAlertSound,
      prepTimeEnabled,
      // Display settings
      customerDisplayEnabled,
      showOrderDetails,
      appointmentDisplayShowName,
      // Inventory settings
      lowStockAlertEnabled,
      lowStockAlerts,
      autoDeductInventory,
      // Order settings
      orderNumberPrefix,
      orderNumberReset,
      // Table ordering settings
      tableOrderingEnabled,
      tablePaymentType,
      allowGuestOrdering,
      // Phase E R2 — reservation duration matrix + turn buffer
      partySizeDurationMap,
      reservationTurnBufferMinutes,
      // Phase E R4 — cancellation window (minutes before booking)
      cancellationWindowMinutes,
      // Phase E R6 — appointment deposit
      requireAppointmentDeposit,
      appointmentDepositType,
      appointmentDepositValue,
    } = body;

    // Reconcile legacy aliases
    const effectiveTipEnabled = tipEnabled ?? allowTips;
    const effectiveTipPresets = tipPresets ?? tipPercentages;
    const effectiveLowStock = lowStockAlertEnabled ?? lowStockAlerts;

    // Validate tip presets
    if (effectiveTipPresets !== undefined) {
      if (!Array.isArray(effectiveTipPresets) || effectiveTipPresets.some((t: any) => typeof t !== "number")) {
        return NextResponse.json(
          { error: "tipPresets must be an array of numbers" },
          { status: 400 }
        );
      }
    }

    // Validate order number reset
    if (orderNumberReset !== undefined) {
      if (!["DAILY", "NEVER"].includes(orderNumberReset)) {
        return NextResponse.json(
          { error: "orderNumberReset must be DAILY or NEVER" },
          { status: 400 }
        );
      }
    }

    // Validate table payment type
    if (tablePaymentType !== undefined) {
      if (!["UPFRONT", "PAY_AT_END"].includes(tablePaymentType)) {
        return NextResponse.json(
          { error: "tablePaymentType must be UPFRONT or PAY_AT_END" },
          { status: 400 }
        );
      }
    }

    const settings = await prisma.tenantSettings.upsert({
      where: { tenantId },
      update: {
        // Tax settings
        ...(taxEnabled !== undefined && { taxEnabled }),
        ...(taxRate !== undefined && { taxRate }),
        ...(taxLabel !== undefined && { taxLabel }),
        ...(tax2Enabled !== undefined && { tax2Enabled }),
        ...(tax2Rate !== undefined && { tax2Rate }),
        ...(tax2Label !== undefined && { tax2Label }),
        // Cash discount fields — percent capped at 15 by DB CHECK
        ...(cashDiscountEnabled !== undefined && { cashDiscountEnabled }),
        ...(cashDiscountPercent !== undefined && {
          cashDiscountPercent: Math.max(0, Math.min(15, Number(cashDiscountPercent))),
        }),
        ...(cashDiscountMode !== undefined &&
          ["SURCHARGE", "DISCOUNT"].includes(cashDiscountMode) && {
            cashDiscountMode,
          }),
        ...(cashDiscountLabel !== undefined && {
          cashDiscountLabel: cashDiscountLabel || null,
        }),
        ...(brandLogoUrl !== undefined && { brandLogoUrl: brandLogoUrl || null }),
        // Tip settings
        ...(effectiveTipEnabled !== undefined && { tipEnabled: effectiveTipEnabled }),
        ...(effectiveTipPresets !== undefined && { tipPresets: effectiveTipPresets }),
        ...(tipCustomEnabled !== undefined && { tipCustomEnabled }),
        // Receipt settings
        ...(receiptHeader !== undefined && { receiptHeader }),
        ...(receiptFooter !== undefined && { receiptFooter }),
        // Kitchen settings
        ...(kitchenDisplayEnabled !== undefined && { kitchenDisplayEnabled }),
        ...(kitchenAlertSound !== undefined && { kitchenAlertSound }),
        ...(prepTimeEnabled !== undefined && { prepTimeEnabled }),
        // Display settings
        ...(customerDisplayEnabled !== undefined && { customerDisplayEnabled }),
        ...(showOrderDetails !== undefined && { showOrderDetails }),
        ...(appointmentDisplayShowName !== undefined && { appointmentDisplayShowName }),
        // Inventory settings
        ...(effectiveLowStock !== undefined && { lowStockAlertEnabled: effectiveLowStock }),
        ...(autoDeductInventory !== undefined && { autoDeductInventory }),
        // Order settings
        ...(orderNumberPrefix !== undefined && { orderNumberPrefix }),
        ...(orderNumberReset !== undefined && { orderNumberReset: orderNumberReset as any }),
        // Table ordering
        ...(tableOrderingEnabled !== undefined && { tableOrderingEnabled }),
        ...(tablePaymentType !== undefined && { tablePaymentType: tablePaymentType as any }),
        ...(allowGuestOrdering !== undefined && { allowGuestOrdering }),
        // Phase E R2 — reservation duration matrix + turn buffer.
        // Object shape is validated in the client; server accepts any
        // JSON since the engine's resolveDurationMinutes normalizes bad
        // shapes to defaults anyway.
        ...(partySizeDurationMap !== undefined && { partySizeDurationMap }),
        ...(reservationTurnBufferMinutes !== undefined && {
          reservationTurnBufferMinutes: Math.max(
            0,
            Math.min(120, Number(reservationTurnBufferMinutes) || 0)
          ),
        }),
        ...(cancellationWindowMinutes !== undefined && {
          cancellationWindowMinutes: Math.max(
            0,
            Math.min(1440, Number(cancellationWindowMinutes) || 0)
          ),
        }),
        ...(requireAppointmentDeposit !== undefined && {
          requireAppointmentDeposit: !!requireAppointmentDeposit,
        }),
        ...(appointmentDepositType !== undefined && {
          appointmentDepositType:
            appointmentDepositType === "FIXED" ? "FIXED" : "PERCENT",
        }),
        ...(appointmentDepositValue !== undefined && {
          // Clamp: PERCENT 0..100, FIXED 0..1_000_000_00 cents ($1M cap).
          appointmentDepositValue: Math.max(
            0,
            Math.min(100_000_000, Number(appointmentDepositValue) || 0)
          ),
        }),
      },
      create: {
        tenantId,
        // Tax settings
        taxEnabled: taxEnabled ?? true,
        taxRate: taxRate ?? 13,
        taxLabel: taxLabel ?? "HST",
        tax2Enabled: tax2Enabled ?? false,
        tax2Rate: tax2Rate ?? 0,
        tax2Label: tax2Label ?? "",
        // Cash discount defaults — off, standard "SURCHARGE" mode ready to enable
        cashDiscountEnabled: cashDiscountEnabled ?? false,
        cashDiscountPercent:
          cashDiscountPercent !== undefined
            ? Math.max(0, Math.min(15, Number(cashDiscountPercent)))
            : 0,
        cashDiscountMode:
          ["SURCHARGE", "DISCOUNT"].includes(cashDiscountMode) ? cashDiscountMode : "SURCHARGE",
        cashDiscountLabel: cashDiscountLabel || null,
        brandLogoUrl: brandLogoUrl || null,
        // Tip settings
        tipEnabled: effectiveTipEnabled ?? true,
        tipPresets: effectiveTipPresets ?? [15, 18, 20, 25],
        tipCustomEnabled: tipCustomEnabled ?? true,
        // Receipt settings
        receiptHeader: receiptHeader ?? "",
        receiptFooter: receiptFooter ?? "Thank you for your business!",
        // Kitchen settings
        kitchenDisplayEnabled: kitchenDisplayEnabled ?? true,
        kitchenAlertSound: kitchenAlertSound ?? true,
        prepTimeEnabled: prepTimeEnabled ?? true,
        // Display settings
        customerDisplayEnabled: customerDisplayEnabled ?? true,
        showOrderDetails: showOrderDetails ?? true,
        appointmentDisplayShowName: appointmentDisplayShowName ?? false,
        // Inventory settings
        lowStockAlertEnabled: effectiveLowStock ?? true,
        autoDeductInventory: autoDeductInventory ?? true,
        // Order settings
        orderNumberPrefix: orderNumberPrefix ?? "",
        orderNumberReset: orderNumberReset ?? "DAILY",
        // Table ordering
        tableOrderingEnabled: tableOrderingEnabled ?? true,
        tablePaymentType: tablePaymentType ?? "UPFRONT",
        allowGuestOrdering: allowGuestOrdering ?? true,
        // Phase E R2 — Prisma will pull the schema-level default for the
        // matrix/buffer if we omit them here, so no explicit fallback.
        ...(partySizeDurationMap !== undefined && { partySizeDurationMap }),
        ...(reservationTurnBufferMinutes !== undefined && {
          reservationTurnBufferMinutes: Math.max(
            0,
            Math.min(120, Number(reservationTurnBufferMinutes) || 0)
          ),
        }),
        ...(cancellationWindowMinutes !== undefined && {
          cancellationWindowMinutes: Math.max(
            0,
            Math.min(1440, Number(cancellationWindowMinutes) || 0)
          ),
        }),
        ...(requireAppointmentDeposit !== undefined && {
          requireAppointmentDeposit: !!requireAppointmentDeposit,
        }),
        ...(appointmentDepositType !== undefined && {
          appointmentDepositType:
            appointmentDepositType === "FIXED" ? "FIXED" : "PERCENT",
        }),
        ...(appointmentDepositValue !== undefined && {
          // Clamp: PERCENT 0..100, FIXED 0..1_000_000_00 cents ($1M cap).
          appointmentDepositValue: Math.max(
            0,
            Math.min(100_000_000, Number(appointmentDepositValue) || 0)
          ),
        }),
      },
    });

    // Also update tenant-level fields (name, currency, timezone) if provided
    const tenantUpdates: any = {};
    if (typeof tenantPatch.name === "string" && tenantPatch.name.trim()) tenantUpdates.name = tenantPatch.name.trim();
    if (typeof tenantPatch.currency === "string" && tenantPatch.currency.trim()) tenantUpdates.currency = tenantPatch.currency.trim();
    if (typeof tenantPatch.timezone === "string" && tenantPatch.timezone.trim()) tenantUpdates.timezone = tenantPatch.timezone.trim();

    let tenant;
    if (Object.keys(tenantUpdates).length > 0) {
      tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: tenantUpdates,
        select: { id: true, name: true, currency: true, timezone: true, businessType: true },
      });
    }

    console.log(`[TAP API] Updated settings for tenant: ${tenantId}`);

    return NextResponse.json({
      success: true,
      settings,
      tenant,
    });
  } catch (error: any) {
    console.error("[TAP API] Update settings error:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
