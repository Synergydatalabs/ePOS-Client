// ============================================================================
// src/lib/s3/index.ts
//
// Public API for the s3 module. Import from here, not from internal files.
// ============================================================================

export {
  getS3Config,
  getS3Client,
  buildKey,
  buildPublicUrl,
  sanitizeFilename,
  assertKeyBelongsToTenant,
  type S3ResourceType,
  type S3Config,
} from "./client";

export {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteObject,
  headObject,
} from "./presigned";
