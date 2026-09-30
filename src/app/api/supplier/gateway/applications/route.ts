// GET  /api/supplier/gateway/applications
//   Lists the current supplier's applications + their active processor row
//   (if any). One compact call powers the whole /supplier/payments page.
//
// POST /api/supplier/gateway/applications
//   Creates a new application (status=SUBMITTED). Sensitive fields (tax id,
//   banking) are AES-GCM encrypted server-side before hitting the DB — the
//   client sends plaintext over HTTPS, we never store plaintext at rest.
//   Beneficial owners are inserted as UboRecord rows (idNumber encrypted
//   per row).
//
// Note (Phase 2b, 2026-08): the models here were renamed from
// PaymentGatewayApplication + SupplierProcessor to MerchantApplication +
// TenantPaymentProvider. The supplier flow keeps `tenantRole=SUPPLIER`.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { kybEncrypt, kybEncryptJson } from "@/lib/kyb-crypto";
import type { PaymentProcessor, UboIdType } from "@prisma/client";

// --- GET -------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

    const [applications, activeProcessor] = await Promise.all([
      prisma.merchantApplication.findMany({
        where: { tenantId: auth.tenant.id, tenantRole: "SUPPLIER" },
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          status: true,
          targetProcessor: true,
          legalName: true,
          submittedAt: true,
          forwardedAt: true,
          approvedAt: true,
          rejectedAt: true,
          infoRequestedAt: true,
          infoRequested: true,
          rejectionReason: true,
          adminNotes: true,
          forwardedToEmail: true,
          processorReferenceId: true,
        },
      }),
      // The active processor row is the "success" side — if this exists,
      // supplier is live and can generate payment links on POs. Suppliers
      // only ever use the CARD capability today, so scope to it explicitly
      // rather than picking whichever ACTIVE row happens to sort first.
      prisma.tenantPaymentProvider.findFirst({
        where: {
          tenantId: auth.tenant.id,
          capability: "CARD",
          status: "ACTIVE",
        },
        select: {
          id: true,
          processor: true,
          externalMid: true,
          status: true,
          activatedAt: true,
          feeScheduleJson: true,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      applications,
      activeProcessor,
    });
  } catch (error: any) {
    console.error("[SUPPLIER-GATEWAY-APPS] GET error:", error);
    return NextResponse.json(
      { error: "Failed to load applications" },
      { status: 500 }
    );
  }
}

// --- POST ------------------------------------------------------------------

interface BeneficialOwnerInput {
  name?: string;
  dob?: string; // ISO date, YYYY-MM-DD
  idNumber?: string; // SSN / SIN / passport — kept in encrypted blob
  address?: string;
  ownershipPct?: number;
}

interface BankInfoInput {
  accountHolderName?: string;
  routingNumber?: string;
  accountNumber?: string;
  bankName?: string;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;

    const body = await request.json();

    // Reject if there's already a live-in-flight application. Suppliers who
    // want to resubmit should wait for admin action on the current one, or
    // ask admin to reject it first. Keeps the queue clean.
    const inflight = await prisma.merchantApplication.findFirst({
      where: {
        tenantId: auth.tenant.id,
        tenantRole: "SUPPLIER",
        status: {
          in: [
            "SUBMITTED",
            "IN_REVIEW",
            "FORWARDED",
            "INFO_REQUESTED",
            "PROVIDER_APPROVED",
          ],
        },
      },
      select: { id: true, status: true },
    });
    if (inflight) {
      return NextResponse.json(
        {
          error: `You already have an application ${inflight.status.toLowerCase().replace("_", " ")}. Cancel or complete it before starting a new one.`,
          existingApplicationId: inflight.id,
        },
        { status: 409 }
      );
    }

    // --- Validate REQUIRED fields ---
    // We don't over-validate optional fields — better to accept partial data
    // and let admin request more via INFO_REQUESTED than to bounce a submit.
    const legalName = String(body.legalName || "").trim();
    if (!legalName) {
      return NextResponse.json({ error: "Legal business name is required" }, { status: 400 });
    }
    const signerName = String(body.signerName || "").trim();
    const signerEmail = String(body.signerEmail || "").trim().toLowerCase();
    if (!signerName) {
      return NextResponse.json({ error: "Signer name is required" }, { status: 400 });
    }
    if (!signerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signerEmail)) {
      return NextResponse.json({ error: "Valid signer email is required" }, { status: 400 });
    }
    if (!body.signerConsented) {
      return NextResponse.json(
        { error: "You must consent to submit this application" },
        { status: 400 }
      );
    }

    // --- Encrypt sensitive fields ---
    // Any of these missing/empty → stored as null. Admin can INFO_REQUEST
    // for completion later without needing another application row.
    const taxIdEnc = kybEncrypt(body.taxId?.trim() || null);

    const bank: BankInfoInput | null =
      body.bankInfo && typeof body.bankInfo === "object" ? body.bankInfo : null;
    const bankInfoEnc = bank
      ? kybEncryptJson({
          accountHolderName: bank.accountHolderName?.trim() || null,
          routingNumber: bank.routingNumber?.trim() || null,
          accountNumber: bank.accountNumber?.trim() || null,
          bankName: bank.bankName?.trim() || null,
        })
      : null;

    // Beneficial owners now live in their own table (UboRecord). We still
    // accept the legacy shape from clients that haven't been rebuilt yet,
    // normalize it, and insert one row per owner INSIDE the create call
    // below via nested writes. Phase 2b — the encrypted JSON blob field
    // is gone.
    const owners: BeneficialOwnerInput[] = Array.isArray(body.beneficialOwners)
      ? body.beneficialOwners
          .map((o: any) => ({
            name: o?.name?.trim() || "",
            dob: o?.dob || null,
            idNumber: o?.idNumber?.trim() || null,
            address: o?.address?.trim() || null,
            ownershipPct:
              typeof o?.ownershipPct === "number" ? o.ownershipPct : null,
          }))
          .filter((o: BeneficialOwnerInput) => o.name)
      : [];

    // --- Non-sensitive fields (plaintext) ---
    const businessAddress = body.businessAddress || null;
    const targetProcessor: PaymentProcessor | null =
      body.targetProcessor && ["GP", "MONERIS", "STRIPE"].includes(body.targetProcessor)
        ? body.targetProcessor
        : null;

    // Financial projection sanity — dollars in the client, cents in the DB.
    const projectedMonthlyVolumeCents =
      typeof body.projectedMonthlyVolume === "number" && body.projectedMonthlyVolume >= 0
        ? Math.round(body.projectedMonthlyVolume * 100)
        : null;
    const averageTicketCents =
      typeof body.averageTicket === "number" && body.averageTicket >= 0
        ? Math.round(body.averageTicket * 100)
        : null;

    // Nested-insert the UBOs alongside the parent application. The Phase 2b
    // UboRecord schema requires a few fields the legacy supplier wizard did
    // not collect (dateOfBirth, nationality, structured address, idType).
    // We plug in placeholders when the client didn't send them so we can
    // still create the parent row; the merchant intake wizard in Phase 2c
    // will populate these properly and the admin UI can flag incomplete
    // records.
    const uboCreateRows = owners.map((o) => {
      const idNumberEnc = kybEncrypt(o.idNumber || "placeholder") || "";
      return {
        fullName: o.name || "Unknown",
        dateOfBirth: o.dob ? new Date(o.dob) : new Date("1900-01-01"),
        nationality: "XXX", // ISO placeholder — Phase 2c wizard will collect real value
        residentialAddress: o.address ? { line1: o.address } : {},
        ownershipPct: o.ownershipPct ?? 0,
        idType: "PASSPORT" as UboIdType,
        idNumberEnc,
      };
    });

    const application = await prisma.merchantApplication.create({
      data: {
        tenantId: auth.tenant.id,
        tenantRole: "SUPPLIER",
        targetProcessor,
        status: "SUBMITTED",

        legalName,
        dbaName: body.dbaName?.trim() || null,
        businessTypeName: body.businessTypeName?.trim() || null,
        incorporationDate: body.incorporationDate ? new Date(body.incorporationDate) : null,
        incorporationRegion: body.incorporationRegion?.trim() || null,
        businessAddress,
        websiteUrl: body.websiteUrl?.trim() || null,
        mccCode: body.mccCode?.trim() || null,

        projectedMonthlyVolumeCents,
        averageTicketCents,
        currency: (body.currency || auth.tenant.currency || "CAD").toUpperCase().substring(0, 3),

        taxIdEnc,
        bankInfoEnc,

        signerName,
        signerTitle: body.signerTitle?.trim() || null,
        signerEmail,
        signerConsentedAt: new Date(),

        createdByMembershipId: auth.session.memberId,

        ubos: uboCreateRows.length ? { create: uboCreateRows } : undefined,
      },
    });

    console.log(
      `[SUPPLIER-GATEWAY-APPS] Submitted: supplier ${auth.tenant.id}, application ${application.id}`
    );

    return NextResponse.json({
      success: true,
      application: {
        id: application.id,
        status: application.status,
        submittedAt: application.submittedAt,
      },
    });
  } catch (error: any) {
    console.error("[SUPPLIER-GATEWAY-APPS] POST error:", error);
    // KYB_ENCRYPTION_KEY missing surfaces here — mask it as a generic
    // "config" error to the supplier, but log the details for ops.
    if (String(error?.message || "").includes("KYB_ENCRYPTION_KEY")) {
      return NextResponse.json(
        {
          error:
            "Server configuration issue. Please contact support before resubmitting — we don't want to lose your data.",
        },
        { status: 500 }
      );
    }
    return NextResponse.json({ error: "Failed to submit application" }, { status: 500 });
  }
}
