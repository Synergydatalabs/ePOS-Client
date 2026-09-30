# Phase 1 Deployment Guide

**Date**: 2026-05-18
**Scope**: Floor Plan + Reservations + S3 Uploads schema foundation

This is the **first of multiple phases**. Phase 1 establishes the database schema and S3 connection. Phase 2+ deliver the UI (floor plan editor, reservations, etc.).

---

## 📋 Pre-flight checklist

Before deploying, confirm:

- [ ] Aurora Postgres connection works from EC2
- [ ] You have a database client (psql, pgAdmin, or DBeaver) that can reach Aurora via your VPC bastion
- [ ] AWS S3 bucket created (see "S3 Setup" below) OR you have AWS console access
- [ ] AWS IAM user created with bucket-scoped policy
- [ ] You have the AWS access key + secret ready

---

## 🗄️ Step 1 — Database migration

The SQL migration is **idempotent within a transaction** but adds new tables and columns. **Backup Aurora before running** (snapshot via AWS console).

### Apply the migration

1. Open your DB client and connect to **itap_pos_dev** on Aurora
2. Open file: `prisma/migrations/manual/2026-05-18_phase1_floor_plan_reservations_uploads.sql`
3. Copy the SQL between `BEGIN;` and `COMMIT;` (inclusive)
4. Execute it as one statement

### Verify

```sql
\dt floor_plans sections reservations waitlist_entries
\dt guest_profiles section_templates server_section_assignments
\dt special_dates guest_arrival_events uploaded_files
\dt floor_plan_versions
\d tables  -- confirm new columns: floor_plan_id, section_id, shape, x, y, width, height, rotation, etc.

-- Should be 0:
SELECT COUNT(*) FROM tables WHERE max_party_size IS NULL;
```

### If migration fails

Run the **ROLLBACK section** at the bottom of the SQL file. Then investigate the error and try again.

---

## 🔧 Step 2 — Schema regeneration on EC2

After SQL succeeds, on the **EC2 server** (where the app runs):

```powershell
cd C:\ZASHX-APPs\tap-app

# Pull latest code (includes updated schema.prisma)
git pull

# Regenerate Prisma Client to pick up new models
npx prisma generate

# Verify Prisma can read the new schema
npx prisma validate
```

**Do NOT run `npx prisma db push` or `npx prisma migrate`** — those would conflict with the SQL we already ran. We're using `db pull / generate` workflow per project standards.

---

## ☁️ Step 3 — S3 bucket setup

If you haven't already:

### Bucket creation

1. AWS Console → S3 → **Create bucket**
2. Name: `oreugo-app-uploads` (must be globally unique; if taken, try `oreugo-app-uploads-prod`)
3. Region: **ca-central-1** (same as your Aurora)
4. **Block all public access**: ON (all four checkboxes ticked)
5. **Versioning**: Enable
6. **Encryption**: SSE-S3 (default)
7. Create

### CORS configuration

After creation: bucket → **Permissions** → **CORS** → paste:

```json
[
  {
    "AllowedOrigins": [
      "https://itap.zashx.com",
      "https://www.oreugo.ca",
      "https://oreugo.ca",
      "http://localhost:4003"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

### Lifecycle policy (optional, saves cost)

Bucket → **Management** → **Lifecycle rules** → create rule:
- Name: `move-old-to-IA`
- Apply to all objects
- Transition to **Standard-IA** after 90 days

### IAM user + minimal policy

1. AWS Console → IAM → **Users** → **Create user**
2. Name: `oreugo-app-s3-uploader`
3. **Programmatic access**: yes (CLI / SDK)
4. **No console access**
5. Attach inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowObjectOperations",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:PutObjectAcl",
        "s3:GetObjectVersion"
      ],
      "Resource": "arn:aws:s3:::oreugo-app-uploads/*"
    },
    {
      "Sid": "AllowBucketList",
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::oreugo-app-uploads"
    }
  ]
}
```

6. Create access key → **Save securely** (you'll only see secret once)

---

## 🔐 Step 4 — Tenant isolation security review

The DB enforces tenant isolation via a trigger:

```sql
-- Any INSERT/UPDATE on uploaded_files MUST have s3_key starting with tenant_id/
-- This prevents Tenant A from creating a record pointing to Tenant B's S3 object.
```

**Application enforcement** (in addition to DB trigger):
- All S3 key generation goes through `lib/s3/client.ts` `buildKey()` helper
- That helper requires a `tenantId` parameter and prepends it
- Server route authenticates the user, derives their tenant, and ALWAYS passes their own tenantId

**Risk to monitor**: a buggy API route that accepts `tenantId` from the request body without validation. **Never trust client-provided tenantId** — always derive from the authenticated session.

**If a tenant isolation issue is suspected**:
1. Set `AWS_S3_UPLOAD_URL_EXPIRES_SECONDS=0` (disables new uploads instantly)
2. Run audit query:
   ```sql
   SELECT s3_key, tenant_id FROM uploaded_files
   WHERE s3_key NOT LIKE (tenant_id::text || '/%');
   -- Should return 0 rows. If not, that's a bug.
   ```
3. Revoke the IAM access key
4. Issue new access key after fix deployed

---

## ⚙️ Step 5 — Environment variables

Add to `.env.production` on EC2:

```env
# S3
AWS_S3_BUCKET=oreugo-app-uploads
AWS_S3_REGION=ca-central-1
AWS_S3_ACCESS_KEY_ID=<from IAM step>
AWS_S3_SECRET_ACCESS_KEY=<from IAM step>
AWS_S3_PUBLIC_URL=
AWS_S3_UPLOAD_URL_EXPIRES_SECONDS=300
AWS_S3_MAX_UPLOAD_BYTES=10485760
```

See `.env.example` for the full list and inline docs.

---

## 🚦 Step 6 — Restart and verify

```powershell
pm2 restart itap-app
pm2 logs itap-app --lines 50
```

Watch for:
- ✅ "Ready in <Xms>" — app started cleanly
- ✅ No Prisma errors about missing models
- ❌ If you see "PrismaClient is unable to be run in the browser" — that's fine for SSR-rendered pages; ignore
- ❌ If you see "no module named '@aws-sdk/client-s3'" — run `npm install` (the S3 SDK gets added in next code drop)

---

## 🧪 Step 7 — Smoke tests

These verify the schema additions work. Run in your DB client:

```sql
-- Test 1: Create a floor plan
INSERT INTO floor_plans (location_id, name, is_default)
VALUES (
  (SELECT id FROM locations LIMIT 1),
  'Smoke Test Floor',
  false
)
RETURNING id, name;

-- Test 2: Create a section
INSERT INTO sections (floor_plan_id, name, color)
VALUES (
  (SELECT id FROM floor_plans ORDER BY created_at DESC LIMIT 1),
  'Smoke Test Section',
  '#FF5733'
)
RETURNING id;

-- Test 3: Verify tenant isolation trigger
INSERT INTO uploaded_files (tenant_id, s3_bucket, s3_key, filename, mime_type, size_bytes, resource_type)
VALUES (
  gen_random_uuid(),
  'test-bucket',
  'wrong-prefix/file.jpg',  -- should FAIL because key doesn't start with tenant_id/
  'file.jpg',
  'image/jpeg',
  1000,
  'product'
);
-- Expected: ERROR: S3 key wrong-prefix/file.jpg must start with tenant_id ...

-- Cleanup smoke tests:
DELETE FROM sections WHERE name = 'Smoke Test Section';
DELETE FROM floor_plans WHERE name = 'Smoke Test Floor';
```

---

## 📦 What ships in Phase 1

| Component | File | Status |
|---|---|---|
| SQL migration | `prisma/migrations/manual/2026-05-18_phase1_*.sql` | ✅ This release |
| Prisma schema | `prisma/schema.prisma` (extended Table + 11 new models) | ✅ This release |
| Env template | `.env.example` | ✅ This release |
| Deployment guide | `docs/PHASE_1_DEPLOYMENT.md` | ✅ This release |
| S3 client | `src/lib/s3/client.ts` | ⏭️ Next code drop |
| Presigned URL API | `src/app/api/uploads/presign/route.ts` | ⏭️ Next code drop |
| CSV menu uploader | `src/components/admin/MenuCsvUploader.tsx` | ⏭️ Next code drop |
| CSV import API | `src/app/api/admin/menu/bulk-upload/route.ts` | ⏭️ Next code drop |

The "Next code drop" pieces are the application layer that USES the schema. They land in the next session, when you confirm Step 1-7 above are working on EC2.

---

## ⏭️ After Phase 1

When this is deployed and smoke-tested green, message me to start Phase 1 part 2 (S3 + CSV upload code). Then Phase 2 begins with the visual floor plan editor.

## ⚠️ If something goes wrong

1. **Migration fails partway through**: it's wrapped in a transaction, so it's all-or-nothing — DB is unchanged on rollback
2. **Prisma generate fails**: schema.prisma has a syntax issue — run `npx prisma validate` to find it
3. **App won't start after deploy**: revert by running the ROLLBACK SQL at the bottom of the migration file, restart PM2, app goes back to pre-Phase-1 state
4. **S3 upload fails (after part 2 deploys)**: check IAM permissions and CORS in this order
