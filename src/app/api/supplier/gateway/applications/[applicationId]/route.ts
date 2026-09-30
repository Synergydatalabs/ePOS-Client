// GET /api/supplier/gateway/applications/[applicationId]
// Detail view for the supplier's OWN application. Sensitive fields
// (tax id, bank account, beneficial owners' IDs) are decrypted then
// MASKED before returning — supplier sees "••••1234" style previews,
// enough to confirm what they submitted without a fresh full copy of
// PII floating around browser cache / logs / screenshots.
//
// If a supplier needs to fully change a value, they submit a new
// application (or admin uses INFO_REQUESTED flow).
//
// Phase 2b (2026-08): models renamed to MerchantApplication +
// TenantPaymentProvider. Beneficial owners are now UboRecord rows —
// we still surface them as a masked list in the same response shape.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requireSupplierAuth } from "@/lib/supplier-auth";
import { kybDecrypt, kybDecryptJson, maskTail } from "@/lib/kyb-crypto";

interface DecryptedBank {
  accountHolderName?: string | null;
  routingNumber?: string | null;
  accountNumber?: string | null;
  bankName?: string | null;
}

interface DecryptedOwner {
  name?: string;
  dob?: string | null;
  idNumber?: string | null;
  address?: string | null;
  ownershipPct?: number | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> }
) {
  try {
    const auth = await requireSupplierAuth(request);
    if (!auth.ok) return auth.response;
    const { applicationId } = await params;

    const app = await prisma.merchantApplication.findFirst({
      where: {
        id: applicationId,
        tenantId: auth.tenant.id,
        tenantRole: "SUPPLIER",
      },
      include: {
        ubos: {
          select: {
            fullName: true,
            dateOfBirth: true,
            residentialAddress: true,
            ownershipPct: true,
            idNumberEnc: true,
          },
        },
      },
    });

    if (!app) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    // Try decrypting the sensitive fields. If a key change / corrupted
    // blob makes it fail, return the row with sensitive fields as `null`
    // rather than 500'ing — the rest of the review UI is still useful.
    let taxIdMasked: string | null = null;
    let bank: DecryptedBank | null = null;
    let owners: DecryptedOwner[] = [];
    let decryptError: string | null = null;

    try {
      const taxId = kybDecrypt(app.taxIdEnc);
      if (taxId) taxIdMasked = maskTail(taxId, 4);

      bank = kybDecryptJson<DecryptedBank>(app.bankInfoEnc);

      // Map UboRecord rows into the legacy `owners` shape the supplier UI
      // consumes. The wire response then masks ID numbers per row below.
      owners = app.ubos.map((u) => {
        let idNumber: string | null = null;
        try {
          idNumber = kybDecrypt(u.idNumberEnc);
        } catch {
          // Per-row decrypt failure shouldn't blank the entire response;
          // just leave the id null so the row still appears.
        }
        const addr = (u.residentialAddress || {}) as Record<string, string>;
        const addressLine =
          typeof u.residentialAddress === "string"
            ? u.residentialAddress
            : [addr.line1, addr.line2, addr.city, addr.province, addr.postalCode, addr.country]
                .filter(Boolean)
                .join(", ") || null;
        return {
          name: u.fullName,
          dob: u.dateOfBirth ? u.dateOfBirth.toISOString().slice(0, 10) : null,
          idNumber,
          address: addressLine,
          ownershipPct: Number(u.ownershipPct),
        };
      });
    } catch (err: any) {
      console.error(
        `[SUPPLIER-GATEWAY-APP] Decrypt failed on application ${applicationId}:`,
        err?.message || err
      );
      decryptError =
        "Some fields couldn't be read (encryption error). Contact support.";
    }

    return NextResponse.json({
      success: true,
      application: {
        id: app.id,
        status: app.status,
        targetProcessor: app.targetProcessor,

        legalName: app.legalName,
        dbaName: app.dbaName,
        businessTypeName: app.businessTypeName,
        incorporationDate: app.incorporationDate,
        incorporationRegion: app.incorporationRegion,
        businessAddress: app.businessAddress,
        websiteUrl: app.websiteUrl,
        mccCode: app.mccCode,

        projectedMonthlyVolumeCents: app.projectedMonthlyVolumeCents,
        averageTicketCents: app.averageTicketCents,
        currency: app.currency,

        // Masked previews of sensitive fields
        taxIdMasked,
        bank: bank
          ? {
              accountHolderName: bank.accountHolderName || null,
              bankName: bank.bankName || null,
              routingNumberMasked: bank.routingNumber
                ? maskTail(bank.routingNumber, 3)
                : null,
              accountNumberMasked: bank.accountNumber
                ? maskTail(bank.accountNumber, 4)
                : null,
            }
          : null,
        beneficialOwners: owners.map((o) => ({
          name: o.name || null,
          dob: o.dob || null,
          address: o.address || null,
          ownershipPct: o.ownershipPct ?? null,
          // ID number masked here too — supplier verifies the tail matches
          // what they typed. Full value never re-crosses the network.
          idNumberMasked: o.idNumber ? maskTail(o.idNumber, 4) : null,
        })),

        signerName: app.signerName,
        signerTitle: app.signerTitle,
        signerEmail: app.signerEmail,
        signerConsentedAt: app.signerConsentedAt,

        // Admin-side fields that a supplier legitimately wants to see
        adminNotes: app.adminNotes,
        forwardedToEmail: app.forwardedToEmail,
        processorReferenceId: app.processorReferenceId,
        rejectionReason: app.rejectionReason,
        infoRequested: app.infoRequested,

        submittedAt: app.submittedAt,
        forwardedAt: app.forwardedAt,
        infoRequestedAt: app.infoRequestedAt,
        approvedAt: app.approvedAt,
        rejectedAt: app.rejectedAt,

        decryptError,
      },
    });
  } catch (error: any) {
    console.error("[SUPPLIER-GATEWAY-APP] GET error:", error);
    return NextResponse.json({ error: "Failed to load application" }, { status: 500 });
  }
}
