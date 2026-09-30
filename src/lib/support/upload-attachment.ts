// Client-side helper: two-step attachment upload (presign → PUT to S3).
// Used by both the widget and full-page composer, and mirrors the shape
// in tapapp-admin. Returns the metadata the caller then puts into the
// POST-message body under `attachments: [...]`.

export interface UploadedAttachment {
  s3Key: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export async function uploadSupportAttachment(args: {
  threadId: string;
  file: File;
  // tap-app callers pass "/api/support/threads/${id}/attachments/presign"
  // and admin callers pass "/api/admin/support/threads/${id}/attachments/presign".
  presignUrl: string;
}): Promise<UploadedAttachment> {
  // 1) Ask the server for a presigned upload URL. Server does size / MIME
  //    checks before minting.
  const presignRes = await fetch(args.presignUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: args.file.name,
      contentType: args.file.type || "application/octet-stream",
      sizeBytes: args.file.size,
    }),
  });
  if (!presignRes.ok) {
    const err = await presignRes.json().catch(() => ({}));
    throw new Error(err.error || `presign failed: HTTP ${presignRes.status}`);
  }
  const { uploadUrl, s3Key } = (await presignRes.json()) as {
    uploadUrl: string;
    s3Key: string;
  };

  // 2) Upload the bytes directly to S3. The presign locked the URL to
  //    the exact (bucket, key, content-type) tuple, so we must send the
  //    same Content-Type header we passed in step 1.
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "content-type": args.file.type || "application/octet-stream" },
    body: args.file,
  });
  if (!put.ok) {
    throw new Error(`S3 upload failed: HTTP ${put.status}`);
  }

  return {
    s3Key,
    fileName: args.file.name,
    contentType: args.file.type || "application/octet-stream",
    sizeBytes: args.file.size,
  };
}

export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
