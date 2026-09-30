// ============================================================================
// src/lib/s3-kyb.ts
//
// KYB (know-your-business) document object storage. Phase 2c: onboarding
// wizard upload + admin download.
//
// Reuses the shared S3 client from src/lib/s3 (same bucket, same IAM
// creds, same region) — KYB docs get their own key prefix so they're
// visually separate from tenant-catalog media, and so a future lifecycle
// / retention policy targeting "kyb/*" leaves menu images alone.
//
// Key layout:  kyb/<tenantId>/<applicationId>/<docType>/<uuid>-<safeName>
//
// SECURITY:
//   - Tenant id is enforced in the key so an accidental cross-tenant key
//     lookup is obvious.
//   - Presigned URL TTL is 5 minutes — short enough that a leaked URL is
//     bounded, long enough that a merchant with a slow upload still
//     completes.
//   - `assertKybKeyBelongsToTenant()` MUST be called by any admin download
//     path that accepts a key from anywhere but its own DB row; today
//     admin paths look up KybDocument by id then use the stored s3Key so
//     the check is belt-and-suspenders.
// ============================================================================

import { randomUUID } from "crypto";
import {
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, getS3Config, sanitizeFilename } from "@/lib/s3";

// 5 minutes — matches the shared uploadUrlExpiresSeconds default but kept
// explicit here so a future bump to the shared TTL doesn't accidentally
// extend KYB URL lifetime.
const KYB_URL_TTL_SECONDS = 300;

// One place to change the KYB key prefix if we ever decide to move it.
const KYB_PREFIX = "kyb";

export interface BuildKybKeyArgs {
  tenantId: string;
  applicationId: string;
  docType: string;
  filename: string;
}

/**
 * Build a KYB S3 key. Never accepts a raw key from the client — the client
 * only passes filename/docType and we control the layout.
 */
export function buildKybKey(args: BuildKybKeyArgs): string {
  if (!args.tenantId) throw new Error("buildKybKey: tenantId is required");
  if (!args.applicationId) throw new Error("buildKybKey: applicationId is required");
  if (!args.docType) throw new Error("buildKybKey: docType is required");
  if (!args.filename) throw new Error("buildKybKey: filename is required");

  const safe = sanitizeFilename(args.filename);
  const uuid = randomUUID();
  const docTypeSlug = args.docType.toLowerCase();
  return `${KYB_PREFIX}/${args.tenantId}/${args.applicationId}/${docTypeSlug}/${uuid}-${safe}`;
}

/**
 * Guard: verify a KYB key belongs to the given tenant. Throws otherwise.
 * Use in download endpoints that resolve a key from a KybDocument row
 * before signing — cheap sanity check that also catches DB corruption.
 */
export function assertKybKeyBelongsToTenant(key: string, tenantId: string): void {
  const expected = `${KYB_PREFIX}/${tenantId}/`;
  if (!key.startsWith(expected)) {
    throw new Error(
      `KYB key tenant mismatch: key does not start with "${expected}"`
    );
  }
}

/**
 * Presigned PUT URL. Caller must know the exact byte size — S3 rejects the
 * upload if content-length differs so we don't waste bandwidth on wrong
 * blobs.
 */
export async function getKybUploadUrl(args: {
  s3Key: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<{ url: string; headers: Record<string, string>; expiresAt: string }> {
  const config = getS3Config();
  if (args.sizeBytes <= 0) throw new Error("sizeBytes must be > 0");
  if (args.sizeBytes > config.maxUploadBytes) {
    throw new Error(
      `File size ${args.sizeBytes} exceeds max ${config.maxUploadBytes} bytes`
    );
  }

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: args.s3Key,
    ContentType: args.mimeType,
    ContentLength: args.sizeBytes,
  });

  const url = await getSignedUrl(getS3Client(), command, {
    expiresIn: KYB_URL_TTL_SECONDS,
  });

  return {
    url,
    headers: { "Content-Type": args.mimeType },
    expiresAt: new Date(Date.now() + KYB_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

/**
 * Presigned GET URL for admin preview / download. Optionally sets a
 * Content-Disposition header so browsers force-download instead of trying
 * to render an unknown MIME inline.
 */
export async function getKybDownloadUrl(args: {
  s3Key: string;
  filename?: string;
  disposition?: "inline" | "attachment";
}): Promise<{ url: string; expiresAt: string }> {
  const config = getS3Config();

  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: args.s3Key,
    ...(args.filename && args.disposition
      ? {
          ResponseContentDisposition: `${args.disposition}; filename="${args.filename.replace(/"/g, "")}"`,
        }
      : {}),
  });

  const url = await getSignedUrl(getS3Client(), command, {
    expiresIn: KYB_URL_TTL_SECONDS,
  });

  return {
    url,
    expiresAt: new Date(Date.now() + KYB_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

// KYB-specific limits for the wizard document uploader.
// Kept here so any future tweak (e.g. raising to 15 MB) happens in one place.
export const KYB_MAX_BYTES_PER_FILE = 10 * 1024 * 1024;      // 10 MB per doc
export const KYB_MAX_BYTES_PER_APPLICATION = 50 * 1024 * 1024; // 50 MB total per app

export const KYB_ALLOWED_MIME_TYPES = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/heic",
  "image/heif",
]);

// Hardcoded KYB doc types — kept parallel to the Prisma enum so we never
// call Object.values(Prisma.KybDocType) at module scope (production bug we
// hit in Phase 1a where that fired before Prisma client was ready).
export const KYB_DOC_TYPES = [
  "ARTICLES_OF_INCORPORATION",
  "BUSINESS_LICENSE",
  "VOID_CHEQUE",
  "BANK_STATEMENT",
  "UBO_ID_FRONT",
  "UBO_ID_BACK",
  "UBO_PROOF_OF_ADDRESS",
  "DIRECTOR_ID",
  "TAX_RETURN",
  "GST_HST_REGISTRATION",
  "OTHER",
] as const;

export type KybDocTypeValue = (typeof KYB_DOC_TYPES)[number];

// Human-readable labels for the wizard UI. Kept alongside the enum so the
// two never drift.
export const KYB_DOC_TYPE_LABELS: Record<KybDocTypeValue, string> = {
  ARTICLES_OF_INCORPORATION: "Articles of Incorporation",
  BUSINESS_LICENSE: "Business License",
  VOID_CHEQUE: "Void Cheque",
  BANK_STATEMENT: "Bank Statement",
  UBO_ID_FRONT: "UBO ID (Front)",
  UBO_ID_BACK: "UBO ID (Back)",
  UBO_PROOF_OF_ADDRESS: "UBO Proof of Address",
  DIRECTOR_ID: "Director ID",
  TAX_RETURN: "Tax Return",
  GST_HST_REGISTRATION: "GST/HST Registration",
  OTHER: "Other",
};

// Which docs must be present for a submit-ready application. Enforced in
// the submit endpoint. UBO-per-person docs (id front/back, proof of
// address) are checked separately since they count per UBO.
export const KYB_REQUIRED_DOC_TYPES: KybDocTypeValue[] = [
  "ARTICLES_OF_INCORPORATION",
  "VOID_CHEQUE",
];
