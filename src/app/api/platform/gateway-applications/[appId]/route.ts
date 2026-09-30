// GET  /api/platform/gateway-applications/[appId]
//   Full detail INCLUDING decrypted KYB data. The only place in the app
//   that returns tax IDs, full bank accounts, and beneficial owners in the
//   clear. Client should treat this response as sensitive (don't cache,
//   don't log). Guarded by requirePlatformAdmin().
//
// POST /api/platform/gateway-applications/[appId]
//   Perform admin actions. Body: { action, ...actionParams }
//   Actions: markInReview | requestInfo | forwardToProcessor | approve | reject
//   Also fires the appropriate email to supplier / processor.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  kybDecrypt,
  kybDecryptJson,
  kybEncryptJson,
} from "@/lib/kyb-crypto";
import type {
  PaymentProcessor,
} from "@prisma/client";
import {
  sendGatewayInfoRequestedEmail,
  sendGatewayForwardedEmail,
  sendGatewayApprovedEmail,
  sendGatewayRejectedEmail,
  sendGatewayProcessorLeadEmail,
} from "@/lib/email";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "";

// Legal transitions FROM current status (admin-side, mirror of what the
// supplier-side detail route enforces from the supplier's perspective).
const ALLOWED_FROM: Record<
  string,
  ("markInReview" | "requestInfo" | "forwardToProcessor" | "approve" | "reject")[]
> = {
  SUBMITTED:      ["markInReview", "requestInfo", "forwardToProcessor", "approve", "reject"],
  IN_REVIEW:      ["requestInfo", "forwardToProcessor", "approve", "reject"],
  INFO_REQUESTED: ["markInReview", "forwardToProcessor", "approve", "reject"],
  FORWARDED:      ["approve", "reject", "requestInfo"],
  APPROVED:       [],
  REJECTED:       [],
  DRAFT:          [],
};

// --- GET -------------------------------------------------------------------

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const auth = await requirePlatformAdmin(request);
    if (!auth.ok) return auth.response;
    const { appId } = await params;

    const app = await prisma.merchantApplication.findUnique({
      where: { id: appId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            currency: true,
            supplierProfile: {
              select: {
                displayName: true,
                contactEmail: true,
                contactPhone: true,
              },
            },
          },
        },
        resultingProcessor: {
          select: {
            id: true,
            processor: true,
            externalMid: true,
            status: true,
            activatedAt: true,
          },
        },
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

    // Decrypt PII — only place in the app we do this. Failure returns the
    // rest of the row so the reviewer can at least see business info +
    // decide how to proceed.
    let taxId: string | null = null;
    let bank: any = null;
    let owners: any[] = [];
    let decryptError: string | null = null;
    try {
      taxId = kybDecrypt(app.taxIdEnc);
      bank = kybDecryptJson(app.bankInfoEnc);
      owners = app.ubos.map((u) => {
        let idNumber: string | null = null;
        try {
          idNumber = kybDecrypt(u.idNumberEnc);
        } catch {
          // per-row decrypt failure — leave id null; row still surfaces
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
      decryptError = err?.message || "Decrypt failed";
      console.error(
        `[PLATFORM-APPS] Decrypt failed on ${appId}:`,
        decryptError
      );
    }

    return NextResponse.json({
      success: true,
      application: {
        id: app.id,
        supplier: {
          id: app.tenant.id,
          legalName: app.tenant.name,
          displayName:
            app.tenant.supplierProfile?.displayName ||
            app.tenant.name,
          contactEmail: app.tenant.supplierProfile?.contactEmail || null,
          contactPhone: app.tenant.supplierProfile?.contactPhone || null,
        },
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

        // DECRYPTED sensitive fields
        taxId,
        bank,
        beneficialOwners: owners,
        decryptError,

        signerName: app.signerName,
        signerTitle: app.signerTitle,
        signerEmail: app.signerEmail,
        signerConsentedAt: app.signerConsentedAt,

        adminNotes: app.adminNotes,
        reviewedByAdminEmail: app.reviewedByAdminEmail,
        forwardedToEmail: app.forwardedToEmail,
        processorReferenceId: app.processorReferenceId,
        rejectionReason: app.rejectionReason,
        infoRequested: app.infoRequested,

        submittedAt: app.submittedAt,
        forwardedAt: app.forwardedAt,
        infoRequestedAt: app.infoRequestedAt,
        approvedAt: app.approvedAt,
        rejectedAt: app.rejectedAt,
        lastAdminActionAt: app.lastAdminActionAt,

        resultingProcessor: app.resultingProcessor,
      },
    });
  } catch (error: any) {
    console.error("[PLATFORM-APPS] GET error:", error);
    return NextResponse.json({ error: "Failed to load application" }, { status: 500 });
  }
}

// --- POST (actions) --------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ appId: string }> }
) {
  try {
    const auth = await requirePlatformAdmin(request);
    if (!auth.ok) return auth.response;
    const { appId } = await params;

    const app = await prisma.merchantApplication.findUnique({
      where: { id: appId },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            supplierProfile: {
              select: {
                displayName: true,
                contactEmail: true,
                contactPhone: true,
              },
            },
          },
        },
      },
    });
    if (!app) {
      return NextResponse.json({ error: "Application not found" }, { status: 404 });
    }

    const body = await request.json();
    const action: string = body.action;
    const allowed = ALLOWED_FROM[app.status] || [];
    if (!allowed.includes(action as any)) {
      return NextResponse.json(
        {
          error: `Cannot ${action} an application that is ${app.status}`,
          currentStatus: app.status,
          allowedActions: allowed,
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const adminEmail = auth.email;
    const supplierName =
      app.tenant.supplierProfile?.displayName || app.tenant.name;
    const supplierContactEmail =
      app.tenant.supplierProfile?.contactEmail ||
      app.signerEmail ||
      null;

    // Helper — most actions just update fields + set the reviewer + optional
    // admin notes. Timestamps + status vary per action.
    let updatedApp: any = null;

    switch (action) {
      case "markInReview": {
        updatedApp = await prisma.merchantApplication.update({
          where: { id: appId },
          data: {
            status: "IN_REVIEW",
            reviewedByAdminEmail: adminEmail,
            lastAdminActionAt: now,
            ...(typeof body.adminNotes === "string" && body.adminNotes.trim()
              ? { adminNotes: body.adminNotes.trim() }
              : {}),
          },
        });
        break;
      }

      case "requestInfo": {
        const requestBody = String(body.infoRequested || "").trim();
        if (!requestBody) {
          return NextResponse.json(
            { error: "Please describe what info you need from the supplier" },
            { status: 400 }
          );
        }
        updatedApp = await prisma.merchantApplication.update({
          where: { id: appId },
          data: {
            status: "INFO_REQUESTED",
            infoRequested: requestBody,
            infoRequestedAt: now,
            reviewedByAdminEmail: adminEmail,
            lastAdminActionAt: now,
          },
        });
        // Notify supplier — fire-and-forget.
        if (supplierContactEmail) {
          sendGatewayInfoRequestedEmail({
            to: supplierContactEmail,
            supplierName,
            requestBody,
            applicationUrl: `${BASE_URL}/supplier/payments/${appId}`,
          }).catch((err) =>
            console.error("[PLATFORM-APPS] info-request email failed:", err?.message)
          );
        }
        break;
      }

      case "forwardToProcessor": {
        const processor: PaymentProcessor | null =
          body.processor && ["GP", "MONERIS", "STRIPE"].includes(body.processor)
            ? body.processor
            : null;
        const processorEmail = String(body.processorEmail || "").trim();
        if (!processor) {
          return NextResponse.json(
            { error: "Pick a processor (GP / MONERIS / STRIPE)" },
            { status: 400 }
          );
        }
        if (!processorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(processorEmail)) {
          return NextResponse.json(
            { error: "Valid processor onboarding email is required" },
            { status: 400 }
          );
        }

        updatedApp = await prisma.merchantApplication.update({
          where: { id: appId },
          data: {
            status: "FORWARDED",
            targetProcessor: processor,
            forwardedAt: now,
            forwardedToEmail: processorEmail,
            reviewedByAdminEmail: adminEmail,
            lastAdminActionAt: now,
          },
        });

        // Two emails: one to the processor (lead), one to the supplier
        // (heads-up). Both fire-and-forget.
        const money = (cents: number | null) =>
          cents == null
            ? null
            : `${app.currency} ${(cents / 100).toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}`;
        sendGatewayProcessorLeadEmail({
          to: processorEmail,
          supplierName,
          supplierContactName: app.signerName,
          supplierContactEmail: supplierContactEmail || app.signerEmail || "",
          supplierContactPhone: app.tenant.supplierProfile?.contactPhone || null,
          processorName: processor,
          projectedMonthlyVolume: money(app.projectedMonthlyVolumeCents),
          averageTicket: money(app.averageTicketCents),
          region: app.incorporationRegion,
          websiteUrl: app.websiteUrl,
          mccCode: app.mccCode,
          fromAdminEmail: adminEmail,
        }).catch((err) =>
          console.error("[PLATFORM-APPS] lead email failed:", err?.message)
        );
        if (supplierContactEmail) {
          sendGatewayForwardedEmail({
            to: supplierContactEmail,
            supplierName,
            processor,
            applicationUrl: `${BASE_URL}/supplier/payments/${appId}`,
          }).catch((err) =>
            console.error("[PLATFORM-APPS] forwarded email failed:", err?.message)
          );
        }
        break;
      }

      case "approve": {
        const processor: PaymentProcessor | null =
          body.processor && ["GP", "MONERIS", "STRIPE"].includes(body.processor)
            ? body.processor
            : app.targetProcessor;
        const externalMid = String(body.externalMid || "").trim();
        const credentials =
          typeof body.credentials === "object" && body.credentials !== null
            ? body.credentials
            : null;
        if (!processor) {
          return NextResponse.json(
            { error: "Processor is required to approve (pick one if not already set)" },
            { status: 400 }
          );
        }
        if (!externalMid) {
          return NextResponse.json(
            { error: "Merchant ID (MID) is required to approve" },
            { status: 400 }
          );
        }
        if (!credentials || Object.keys(credentials).length === 0) {
          return NextResponse.json(
            {
              error:
                "Processor credentials are required to approve — provide the API keys / tokens as JSON",
            },
            { status: 400 }
          );
        }

        // Optional fee schedule — { percentBps, fixedCents }
        const feeSchedule =
          typeof body.feeSchedule === "object" && body.feeSchedule !== null
            ? body.feeSchedule
            : null;

        // Encrypt credentials once, up-front — outside the transaction so a
        // crypto config error (missing KYB_ENCRYPTION_KEY) surfaces early
        // instead of poisoning a partial DB write.
        let credentialsEnc: string;
        try {
          credentialsEnc = kybEncryptJson(credentials) || "";
        } catch (err: any) {
          console.error("[PLATFORM-APPS] Credential encrypt failed:", err?.message);
          return NextResponse.json(
            { error: "Failed to encrypt credentials — check KYB_ENCRYPTION_KEY" },
            { status: 500 }
          );
        }
        if (!credentialsEnc) {
          return NextResponse.json(
            { error: "Credentials encryption produced empty output" },
            { status: 500 }
          );
        }

        updatedApp = await prisma.$transaction(async (tx) => {
          // Update the application row.
          const u = await tx.merchantApplication.update({
            where: { id: appId },
            data: {
              status: "APPROVED",
              targetProcessor: processor,
              processorReferenceId: externalMid,
              approvedAt: now,
              reviewedByAdminEmail: adminEmail,
              lastAdminActionAt: now,
            },
          });

          // Upsert TenantPaymentProvider row — the unique key is
          // (tenantId, capability, processor). Legacy suppliers only use
          // the CARD capability, so we hard-code it here; multi-capability
          // routing is a Phase 2c/2d admin action, not part of this flow.
          await tx.tenantPaymentProvider.upsert({
            where: {
              tenantId_capability_processor: {
                tenantId: app.tenantId,
                capability: "CARD",
                processor,
              },
            },
            create: {
              tenantId: app.tenantId,
              capability: "CARD",
              processor,
              externalMid,
              credentialsEnc,
              feeScheduleJson: feeSchedule,
              status: "ACTIVE",
              activatedAt: now,
              applicationId: appId,
            },
            update: {
              externalMid,
              credentialsEnc,
              feeScheduleJson: feeSchedule,
              status: "ACTIVE",
              activatedAt: now,
              suspendedAt: null,
              suspensionReason: null,
              applicationId: appId,
            },
          });

          // Bump the supplier's onboarding funnel to ACTIVE — dashboard
          // checklist reflects the new state.
          await tx.supplierProfile.updateMany({
            where: { tenantId: app.tenantId },
            data: { onboardingStatus: "ACTIVE" },
          });

          return u;
        });

        if (supplierContactEmail) {
          sendGatewayApprovedEmail({
            to: supplierContactEmail,
            supplierName,
            processor,
            externalMid,
            paymentsUrl: `${BASE_URL}/supplier/payments`,
          }).catch((err) =>
            console.error("[PLATFORM-APPS] approved email failed:", err?.message)
          );
        }
        break;
      }

      case "reject": {
        const reason = String(body.rejectionReason || "").trim();
        if (!reason) {
          return NextResponse.json(
            { error: "Please provide a rejection reason" },
            { status: 400 }
          );
        }
        updatedApp = await prisma.merchantApplication.update({
          where: { id: appId },
          data: {
            status: "REJECTED",
            rejectionReason: reason,
            rejectedAt: now,
            reviewedByAdminEmail: adminEmail,
            lastAdminActionAt: now,
          },
        });
        if (supplierContactEmail) {
          sendGatewayRejectedEmail({
            to: supplierContactEmail,
            supplierName,
            reason,
            applicationUrl: `${BASE_URL}/supplier/payments/${appId}`,
          }).catch((err) =>
            console.error("[PLATFORM-APPS] rejected email failed:", err?.message)
          );
        }
        break;
      }

      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    console.log(
      `[PLATFORM-APPS] ${appId}: ${app.status} → ${updatedApp?.status} (by ${adminEmail}, action=${action})`
    );

    return NextResponse.json({
      success: true,
      application: {
        id: updatedApp.id,
        status: updatedApp.status,
      },
    });
  } catch (error: any) {
    console.error("[PLATFORM-APPS] POST error:", error);
    return NextResponse.json({ error: "Failed to perform action" }, { status: 500 });
  }
}
