# Phase 1b + 1c Deployment Guide

**Date**: 2026-05-18
**Scope**: S3 upload infrastructure + CSV menu uploader UI/API
**Depends on**: Phase 1a (DB migration) must be applied first

This drop adds:
- S3 client + presigned URL endpoints
- Bulk menu CSV upload (template + parser + folder picker + bulk insert)

---

## 📁 Files added in this drop

| File | Purpose |
|---|---|
| `src/lib/s3/client.ts` | S3 SDK client, tenant-isolated key builder |
| `src/lib/s3/presigned.ts` | Generate presigned PUT/GET URLs |
| `src/lib/s3/index.ts` | Public exports |
| `src/lib/csv/menu-import.ts` | CSV parse + validate + template generator |
| `src/app/api/tenants/[tenantId]/uploads/presign/route.ts` | POST → presigned upload URL |
| `src/app/api/tenants/[tenantId]/uploads/confirm/route.ts` | POST → mark upload COMPLETED |
| `src/app/api/tenants/[tenantId]/menu/template/route.ts` | GET → download CSV template |
| `src/app/api/tenants/[tenantId]/menu/bulk-upload/route.ts` | POST → bulk create products |
| `src/components/admin/MenuCsvUploader.tsx` | 3-step React wizard |
| `src/app/dashboard/admin/menu/bulk-upload/page.tsx` | Page hosting the wizard |

Updated `package.json` (new deps):
- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`
- `papaparse`
- `@types/papaparse` (dev)

---

## 🚀 Deploy steps

### 1. Pull code on EC2

```powershell
cd C:\ZASHX-APPs\tap-app
git pull
npm install      # installs the 4 new deps
```

### 2. Confirm env vars are set (from Phase 1a)

```powershell
Get-Content .env.production | Select-String "AWS_S3"
```

Should show all 7 variables (bucket, region, key, secret, public URL, expiry, max bytes).

### 3. Build + restart

```powershell
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
pm2 restart itap-app
pm2 logs itap-app --lines 50
```

Look for:
- ✅ "Ready in <Xms>"
- ❌ Any "AWS_S3_BUCKET is not configured" → env var missing

### 4. Verify bundle contains new code

```powershell
# Should return matches
Select-String -Path .next/server/app/api/tenants -Pattern "presign" -Recurse -List | head -3
Select-String -Path .next/server/app/api/tenants -Pattern "bulk-upload" -Recurse -List | head -3
```

---

## 🧪 Manual testing

### Test 1 — Smoke test the presigned URL endpoint

```powershell
# Get your auth cookie from browser DevTools first
# Then:
curl.exe -X POST `
  -H "Content-Type: application/json" `
  -H "Cookie: <your-session-cookie>" `
  -d '{"filename":"test.jpg","contentType":"image/jpeg","size":12345,"resourceType":"product"}' `
  https://itap.zashx.com/api/tenants/<tenant-uuid>/uploads/presign
```

Expected response:
```json
{
  "uploadId": "uuid",
  "uploadUrl": "https://itap-pos-uploads-...amazonaws.com/...?X-Amz-...",
  "uploadMethod": "PUT",
  "uploadHeaders": { "Content-Type": "image/jpeg" },
  "publicUrl": "https://itap-pos-uploads-...amazonaws.com/<tenant>/product/test-...jpg",
  "s3Key": "<tenant>/product/test-...jpg",
  "expiresAt": "2026-05-18T..."
}
```

### Test 2 — Upload a real image manually

```powershell
# Take a small image, upload it via the presigned URL:
curl.exe -X PUT `
  -H "Content-Type: image/jpeg" `
  --data-binary "@C:/path/to/test.jpg" `
  "<uploadUrl from step 1>"
# Should return HTTP 200 with empty body
```

Then confirm in your DB:
```sql
SELECT id, s3_key, upload_status, size_bytes, uploaded_at
FROM uploaded_files
ORDER BY created_at DESC
LIMIT 5;
-- Should show your test row with status PENDING
```

### Test 3 — Full end-to-end via the UI

1. Open browser → `https://itap.zashx.com/dashboard/admin/menu/bulk-upload`
2. Click "Download Template" → save CSV
3. Open CSV in Excel/Numbers, edit a few rows:
   ```
   name,category,price,sku,description,cost,prep_time_mins,image_filename,is_active,sort_order
   Burger,Mains,12.50,BRG-001,Cheeseburger,4.20,8,burger.jpg,true,1
   Pizza,Mains,15.00,PZA-001,Margherita pizza,5.00,15,pizza.jpg,true,2
   ```
4. Save as CSV (UTF-8)
5. Put `burger.jpg` and `pizza.jpg` in a folder on your computer
6. In the wizard:
   - Click "Choose CSV file" → pick your CSV → preview appears
   - Click "Choose folder" → pick your image folder → matches appear
   - Click "Continue to Review" → see summary
   - Click "Create 2 products"
7. Watch the progress bar → "Menu upload complete"
8. Visit `/dashboard/admin/menu/products` → see new products with images ✅

### Test 4 — Tenant isolation verification

This is the security boundary test. Try to upload to a different tenant's prefix:

```sql
-- This SHOULD fail with a trigger error
INSERT INTO uploaded_files (tenant_id, s3_bucket, s3_key, filename, mime_type, size_bytes, resource_type)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  -- one tenant
  'itap-pos-uploads-235494782307-us-east-1-an',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/product/sneaky.jpg',  -- different tenant prefix
  'sneaky.jpg',
  'image/jpeg',
  1000,
  'product'
);
-- Expected: ERROR — "S3 key ... must start with tenant_id ..."
```

If this insert SUCCEEDS, the DB trigger from Phase 1a wasn't applied. Re-run the migration.

---

## 🔍 What to monitor in production

| Metric | Where to check | What it means |
|---|---|---|
| `uploaded_files` rows with `upload_status = 'PENDING'` older than 24h | Daily DB query | Browser started upload but never confirmed — likely network failure, candidate for cleanup |
| S3 console → bucket metrics → 4xx/5xx errors | AWS Console | Auth or CORS misconfiguration |
| PM2 logs grep "presign" | EC2 | Per-upload activity |
| PM2 logs grep "bulk-upload" error | EC2 | CSV import failures |

### Useful queries

```sql
-- Find orphaned PENDING uploads from over 1 day ago (cleanup candidates)
SELECT id, tenant_id, s3_key, size_bytes, created_at
FROM uploaded_files
WHERE upload_status = 'PENDING' AND created_at < NOW() - INTERVAL '24 hours';

-- Total storage by tenant
SELECT
  tenant_id,
  COUNT(*) AS file_count,
  pg_size_pretty(SUM(size_bytes)::bigint) AS total_size
FROM uploaded_files
WHERE upload_status = 'COMPLETED'
GROUP BY tenant_id
ORDER BY SUM(size_bytes) DESC;
```

---

## 🛡️ Security recap

| Layer | Protection |
|---|---|
| **Frontend** | All upload UI requires auth (admin session check before render) |
| **API route** | `validateRequest(request, tenantId, "POS_ADMIN")` — re-checked server-side |
| **S3 key generation** | `buildKey()` forces tenantId prefix; no overload exists without it |
| **Presigned URL** | Expires after 5 min (configurable); single-use per object |
| **DB trigger** | `enforce_s3_tenant_isolation()` — rejects any cross-tenant key insert |
| **IAM policy** | API key scoped to ONE bucket; can't escalate to other AWS resources |
| **CORS** | Browser uploads only allowed from your domains |
| **MIME whitelist** | Only `image/jpeg`, `image/png`, `image/webp`, `image/gif` accepted |
| **Size limit** | 10MB default per upload (configurable via env) |

If a tenant's auth cookie leaks: attacker can only upload to that one tenant's prefix. Cannot read other tenants. Cannot read DB.

If S3 IAM key leaks: attacker can read/write/delete this one bucket. Cannot access other AWS resources. Cannot read DB.

---

## ⏭️ Next phases

Phase 1 is now complete. After your team validates this works:

- **Phase 2**: Floor plan editor (react-konva canvas)
- **Phase 3**: Live floor view (staff side)
- **Phase 4**: Reservations module (3-tap creation)
- **Phase 5**: White-label customer booking page
- **Phase 6**: Google Business Profile integration
- **Phase 7**: 3D customer view (Three.js)
- **Phase 8**: WhatsApp integration

Each phase ships as its own deployable bundle.
