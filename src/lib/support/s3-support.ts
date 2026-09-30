// Mirror of tapapp-admin/src/lib/support/s3-support.ts. Same bucket, same
// key layout, same TTLs. Two copies because the apps are separate npm
// packages — no way to share a lib file cleanly. Keep them in lockstep.

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

const UPLOAD_TTL_SECONDS = 300;
const DOWNLOAD_TTL_SECONDS = 300;

export const SUPPORT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export const SUPPORT_ATTACHMENT_ALLOWED_MIME = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
  "application/zip",
]);

function getEnv(): { bucket: string; region: string } {
  const bucket = process.env.S3_BUCKET_NAME || process.env.AWS_S3_BUCKET;
  const region = process.env.AWS_REGION || process.env.AWS_S3_REGION;
  if (!bucket) throw new Error("S3_BUCKET_NAME (or AWS_S3_BUCKET) is not set");
  if (!region) throw new Error("AWS_REGION (or AWS_S3_REGION) is not set");
  return { bucket, region };
}

let cachedClient: S3Client | null = null;
function client(): S3Client {
  if (!cachedClient) cachedClient = new S3Client({ region: getEnv().region });
  return cachedClient;
}

export function buildSupportAttachmentKey(args: {
  threadId: string;
  fileName: string;
}): string {
  const safe = args.fileName.replace(/[^\w.\-]/g, "_").slice(-120);
  const id = crypto.randomBytes(8).toString("hex");
  return `support/${args.threadId}/${id}-${safe}`;
}

export async function presignSupportUpload(args: {
  key: string;
  contentType: string;
}): Promise<{ url: string; expiresAt: string }> {
  const { bucket } = getEnv();
  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      ContentType: args.contentType,
    }),
    { expiresIn: UPLOAD_TTL_SECONDS }
  );
  return {
    url,
    expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
  };
}

export async function presignSupportDownload(args: {
  s3Key: string;
  fileName: string;
}): Promise<string> {
  const { bucket } = getEnv();
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket,
      Key: args.s3Key,
      ResponseContentDisposition: `attachment; filename="${args.fileName.replace(/"/g, "")}"`,
    }),
    { expiresIn: DOWNLOAD_TTL_SECONDS }
  );
}
