// ============================================================================
// src/lib/s3/client.ts
//
// S3 client + tenant-isolated key builder.
//
// SECURITY MODEL:
//   - One bucket, multi-tenant by key prefix: <tenantId>/<resourceType>/<file>
//   - The `buildKey()` helper is the ONLY way to generate S3 keys.
//   - Helper requires tenantId — there is no overload that omits it.
//   - DB trigger (enforce_s3_tenant_isolation) is a backstop: even if app
//     code is buggy, the DB rejects any uploaded_files row whose s3_key
//     doesn't start with tenant_id/.
//
// Server-side only. Do not import from client components — the AWS SDK
// pulls in too much weight for browsers, and we never want secret keys
// to leak into the client bundle.
// ============================================================================

import { S3Client } from "@aws-sdk/client-s3";

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrlPrefix: string; // e.g. https://cdn.oreugo.ca or "" to fall back to S3 URL
  uploadUrlExpiresSeconds: number;
  maxUploadBytes: number;
}

let cachedClient: S3Client | null = null;

/**
 * Read S3 config from env. Throws a clear error if anything is missing —
 * better than a cryptic AWS error 6 layers deep.
 */
export function getS3Config(): S3Config {
  const bucket = process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_S3_REGION;
  const accessKeyId = process.env.AWS_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_S3_SECRET_ACCESS_KEY;

  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "S3 not configured. Set AWS_S3_BUCKET, AWS_S3_REGION, AWS_S3_ACCESS_KEY_ID, AWS_S3_SECRET_ACCESS_KEY in .env"
    );
  }

  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    publicUrlPrefix: (process.env.AWS_S3_PUBLIC_URL || "").replace(/\/+$/, ""),
    uploadUrlExpiresSeconds: parseInt(
      process.env.AWS_S3_UPLOAD_URL_EXPIRES_SECONDS || "300",
      10
    ),
    maxUploadBytes: parseInt(
      process.env.AWS_S3_MAX_UPLOAD_BYTES || "10485760", // 10 MB default
      10
    ),
  };
}

/**
 * Singleton S3 client. Reuses TCP connections — much faster than creating
 * per-request.
 */
export function getS3Client(): S3Client {
  if (cachedClient) return cachedClient;

  const config = getS3Config();
  cachedClient = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return cachedClient;
}

// ============================================================================
// Tenant isolation helpers
// ============================================================================

/**
 * Resource categories — controls the folder structure inside each tenant prefix.
 * Add new types here as features need them.
 */
export type S3ResourceType =
  | "product"          // menu item images
  | "category"         // category banner images
  | "logo"             // tenant logo / branding
  | "floor_plan_bg"    // architect drawing backgrounds for floor plans
  | "restaurant_media" // photos, videos, 360° panoramas (Phase 3b)
  | "user_avatar"      // staff profile pictures
  | "tmp";             // short-lived uploads (cleared via lifecycle rule)

/**
 * Build an S3 key with the mandatory tenantId prefix.
 *
 * Format:  <tenantId>/<resourceType>/<safeFilename>
 * Example: 3f2a.../product/burger-deluxe-1716042311.jpg
 *
 * - tenantId MUST be a real UUID (we don't validate format here; the DB
 *   trigger does at insert time)
 * - filename gets a timestamp suffix to avoid collisions when users upload
 *   files with same names
 * - Special chars get stripped from the filename for safety
 */
export function buildKey(args: {
  tenantId: string;
  resourceType: S3ResourceType;
  filename: string;
}): string {
  if (!args.tenantId) {
    throw new Error("buildKey: tenantId is required (tenant isolation)");
  }
  if (!args.filename) {
    throw new Error("buildKey: filename is required");
  }

  const safe = sanitizeFilename(args.filename);
  const timestamp = Date.now();
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";

  return `${args.tenantId}/${args.resourceType}/${stem}-${timestamp}${ext}`;
}

/**
 * Strip dangerous chars from filename. Keeps alphanumerics, dash, underscore, dot.
 * Replaces everything else with a dash. Truncates very long names.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 100) || "file";
}

/**
 * Verify a key belongs to the given tenant. Use this in any API route that
 * accepts a key from the client — never trust client-supplied keys without
 * this check.
 */
export function assertKeyBelongsToTenant(key: string, tenantId: string): void {
  if (!key.startsWith(`${tenantId}/`)) {
    throw new Error(
      `S3 key tenant mismatch: key starts with "${key.split("/")[0]}" but tenant is "${tenantId}"`
    );
  }
}

/**
 * Build a public URL for an object. Uses CDN prefix if configured,
 * otherwise falls back to the direct S3 URL.
 *
 * Note: object must be readable by the URL's recipient. For private objects,
 * use getPresignedDownloadUrl() instead.
 */
export function buildPublicUrl(key: string): string {
  const config = getS3Config();
  if (config.publicUrlPrefix) {
    return `${config.publicUrlPrefix}/${key}`;
  }
  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key}`;
}
