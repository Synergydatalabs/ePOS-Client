// ============================================================================
// src/lib/s3/presigned.ts
//
// Generate presigned URLs for direct browser <-> S3 upload/download.
//
// Why presigned URLs vs. proxying through Next.js?
//   - Massive bandwidth savings (Next.js never sees the bytes)
//   - Lower latency (browser hits S3 edge directly)
//   - Standard, well-understood S3 pattern
//
// Security:
//   - URLs expire (default 5 min) so even a leak is bounded
//   - We sign with the bucket-scoped IAM key — leak = bucket only, not whole AWS
//   - Caller MUST verify tenant ownership before calling these helpers
// ============================================================================

import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, getS3Config } from "./client";

/**
 * Generate a presigned URL the browser uses to PUT a file directly to S3.
 *
 * Caller provides:
 *   - key: full S3 key (must already include tenantId prefix — use buildKey())
 *   - contentType: MIME (e.g. "image/jpeg")
 *   - contentLength: byte size, for size validation against our cap
 *
 * Returns the URL plus the headers the browser MUST send on its PUT request.
 * If the browser sends different headers/content-length, S3 rejects the upload.
 */
export async function getPresignedUploadUrl(args: {
  key: string;
  contentType: string;
  contentLength: number;
  cacheControl?: string;
}): Promise<{
  url: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: Date;
}> {
  const config = getS3Config();

  // Enforce max upload size at sign time so we don't waste a presigned URL
  // on something that would fail at upload time.
  if (args.contentLength > config.maxUploadBytes) {
    throw new Error(
      `File size ${args.contentLength} exceeds max ${config.maxUploadBytes} bytes`
    );
  }
  if (args.contentLength <= 0) {
    throw new Error("File size must be > 0");
  }

  const cmdInput: PutObjectCommandInput = {
    Bucket: config.bucket,
    Key: args.key,
    ContentType: args.contentType,
    ContentLength: args.contentLength,
  };

  if (args.cacheControl) {
    cmdInput.CacheControl = args.cacheControl;
  }

  const command = new PutObjectCommand(cmdInput);

  const url = await getSignedUrl(getS3Client(), command, {
    expiresIn: config.uploadUrlExpiresSeconds,
  });

  return {
    url,
    method: "PUT",
    headers: {
      "Content-Type": args.contentType,
      ...(args.cacheControl ? { "Cache-Control": args.cacheControl } : {}),
    },
    expiresAt: new Date(Date.now() + config.uploadUrlExpiresSeconds * 1000),
  };
}

/**
 * Generate a presigned URL for downloading a private object.
 * Use this for files where buildPublicUrl() can't be used (e.g. CDN not
 * configured + bucket has all-public blocked).
 */
export async function getPresignedDownloadUrl(args: {
  key: string;
  expiresSeconds?: number;
  contentDispositionFilename?: string;
}): Promise<string> {
  const config = getS3Config();
  const expires = args.expiresSeconds ?? config.uploadUrlExpiresSeconds;

  const command = new GetObjectCommand({
    Bucket: config.bucket,
    Key: args.key,
    ...(args.contentDispositionFilename && {
      ResponseContentDisposition: `attachment; filename="${args.contentDispositionFilename.replace(/"/g, "")}"`,
    }),
  });

  return getSignedUrl(getS3Client(), command, { expiresIn: expires });
}

/**
 * Delete an object. Used when a product/category is deleted and we want
 * to clean up its image.
 */
export async function deleteObject(key: string): Promise<void> {
  const config = getS3Config();
  await getS3Client().send(
    new DeleteObjectCommand({ Bucket: config.bucket, Key: key })
  );
}

/**
 * Check if an object exists and get its metadata. Useful for verifying
 * an upload actually completed before marking the related DB row as
 * COMPLETED.
 */
export async function headObject(key: string): Promise<{
  exists: boolean;
  contentLength?: number;
  contentType?: string;
  etag?: string;
}> {
  const config = getS3Config();
  try {
    const res = await getS3Client().send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key })
    );
    return {
      exists: true,
      contentLength: res.ContentLength,
      contentType: res.ContentType,
      etag: res.ETag,
    };
  } catch (err: any) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
      return { exists: false };
    }
    throw err;
  }
}
