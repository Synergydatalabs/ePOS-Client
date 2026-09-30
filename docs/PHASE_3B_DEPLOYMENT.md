# Phase 3b Deployment — Restaurant Media Gallery + Custom Polygon Shapes

**Date**: 2026-05-18
**Scope**:
- New "Media Gallery" admin page — upload photos, videos, 360° panoramas per location
- Custom polygon shapes in floor plan editor — L-tables, curved banquettes, freeform layouts
- 360° panorama tagging (sets up Phase 3c virtual tour)

**Prerequisites**: Phase 1 (DB schema + S3) + Phase 2 (floor plan editor) + Phase 3a (polish) all deployed.

---

## 🗄️ Database changes — REQUIRED

Run **this** SQL migration on Aurora:
```
prisma/migrations/manual/2026-05-18_phase3b_media_items.sql
```

Creates:
- `media_type` enum (`PHOTO`, `VIDEO`, `PANORAMA_360`)
- `media_items` table — per-location media library
- 4 indexes + 1 partial unique index (one cover photo per location)
- `updated_at` trigger

Backup Aurora first, then run inside a transaction (the file already has `BEGIN`/`COMMIT`).

After SQL succeeds, on EC2:
```powershell
npx prisma generate
```

---

## 📦 Files to copy (16 new + 7 modified)

### New files (16)
```
prisma/migrations/manual/2026-05-18_phase3b_media_items.sql

src/app/api/tenants/[tenantId]/locations/[locationId]/media/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/media/[mediaId]/route.ts

src/components/restaurant-media/RestaurantMediaGallery.tsx
src/app/dashboard/admin/restaurant-media/page.tsx

docs/PHASE_3B_DEPLOYMENT.md
```

### Modified files (7)
```
prisma/schema.prisma                                   (MediaItem model + relations)
src/lib/floor-plan/types.ts                            (customPolygon on TableDto)
src/lib/s3/client.ts                                   (restaurant_media resource type)
src/app/api/tenants/[tenantId]/uploads/presign/route.ts (add restaurant_media + video MIMEs)
src/app/api/tenants/[tenantId]/locations/[locationId]/floor-plans/[floorPlanId]/tables/route.ts  (customPolygon persistence)
src/components/admin/AdminSidebar.tsx                  (Media Gallery sidebar link)
src/components/floor-plan/CanvasStage.tsx              (polygon drawing mode)
src/components/floor-plan/TableShape.tsx               (CUSTOM polygon rendering)
src/components/floor-plan/Toolbar.tsx                  (Polygon button)
src/components/floor-plan/FloorPlanEditor.tsx          (polygon mode + handler)
```

### New folders to create on EC2
```powershell
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\media"
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\media\[mediaId]"
mkdir src\components\restaurant-media
mkdir src\app\dashboard\admin\restaurant-media
```

### npm packages
**None new.** All deps from earlier phases cover this.

---

## 🚀 Deploy sequence

```powershell
cd C:\ZASHX-APPs\tap-app

# 1. Backup Aurora (snapshot via AWS console)

# 2. Run the SQL migration on Aurora (psql / pgAdmin)
#    File: prisma/migrations/manual/2026-05-18_phase3b_media_items.sql

# 3. Pull code on EC2 (git or manual copy)
git pull

# 4. Regenerate Prisma client (NEW table = MediaItem)
npx prisma generate

# 5. Clean rebuild
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build

# 6. Restart
pm2 restart itap-app
pm2 logs itap-app --lines 30
```

---

## 🧪 Test plan (12 min)

### Test 1 — Media Gallery sidebar link (30 sec)
1. Open admin dashboard
2. Look at left sidebar
3. ✅ **Expected**: New top-level "Media Gallery" link (below Tables)
4. Click → navigates to `/dashboard/admin/restaurant-media`

### Test 2 — Empty state (30 sec)
1. ✅ **Expected**: "Drop photos or videos here" drop zone + "No photos or videos yet" message

### Test 3 — Drag-drop photo upload (2 min)
1. Drag a JPG from your desktop onto the drop zone
2. ✅ **Expected**:
   - Drop zone highlights blue
   - "Uploading 1 file(s)..." pending list appears
   - Progress bar fills 10% → 25% → 75% → 100%
   - File appears in gallery grid

### Test 4 — Multi-file upload (1 min)
1. Click "Or click to browse"
2. Select 3-5 images at once
3. ✅ **Expected**: All upload in parallel (max 3 concurrent), grid fills

### Test 5 — Video upload (1 min)
1. Drop a small MP4 (under 10MB)
2. ✅ **Expected**: Uploads, appears with play icon overlay + "VIDEO" badge

### Test 6 — Set cover photo (30 sec)
1. Hover over any photo → "★ Set cover" button appears
2. Click it
3. ✅ **Expected**: "Cover photo set" toast. That photo gets a yellow "★ COVER" badge.
4. Hover another photo → set as cover
5. ✅ **Expected**: First photo loses cover badge, new one gets it (only one cover per location, enforced by DB)

### Test 7 — Photo detail dialog (1 min)
1. Click any photo (not hover, click)
2. ✅ **Expected**: Modal opens with large preview, metadata stats, caption + alt text fields
3. Type a caption → click outside the input
4. ✅ **Expected**: Saves on blur (no save button needed)
5. Close dialog → reopen the same photo
6. ✅ **Expected**: Caption persisted

### Test 8 — Mark as 360° panorama (1 min)
1. Open a photo's detail dialog
2. Click "Mark as 360° panorama"
3. Prompt asks for scene name
4. Type "Main Dining" → OK
5. ✅ **Expected**: Toast. Photo now shows "360°: Main Dining" badge in dialog. Tile shows purple "360°" badge.
6. **Note**: For real 360° you need an equirectangular image (2:1 aspect ratio), but the feature works with any image — the 360° viewer in Phase 3c will only render proper equirectangular images correctly.

### Test 9 — Delete photo (30 sec)
1. Open detail dialog → click "Delete"
2. Confirm
3. ✅ **Expected**: Photo removed from grid. Soft-deleted in DB (`is_active=false`).

### Test 10 — Custom polygon shape in floor plan (3 min)
1. Navigate to `/dashboard/admin/floor-plan`
2. Open or create a floor plan
3. ✅ **Expected**: Left toolbar now shows new "Custom Shape" section with a "Polygon" button (between shapes and sections)
4. Click "Polygon" button
5. ✅ **Expected**: Button highlights blue, "Drawing..." label, instructional text appears
6. Click 5-7 points on the canvas to outline an L-shaped table
7. ✅ **Expected**: Dashed indigo line connects placed points. First point shows a yellow circle (close target).
8. Click the first (yellow) point to close, OR double-click anywhere
9. ✅ **Expected**:
   - Polygon becomes a real table shape (grey fill, indigo border)
   - Auto-numbered (next available number)
   - Selected with Transformer handles
   - Toast: "Custom shape added — table N"
10. Press Esc to cancel mid-draw at any time

### Test 11 — Save + reload custom polygon (1 min)
1. Click "Save draft"
2. ✅ **Expected**: Save succeeds
3. Hard-refresh browser (Ctrl+Shift+R)
4. ✅ **Expected**: Custom polygon table re-renders with same shape (read from `custom_polygon` JSONB)

### Test 12 — DB verification (1 min)

```sql
-- Check media items
SELECT id, media_type, is_cover, scene_name, caption, display_order
FROM media_items
WHERE location_id = '<your-location-id>'
ORDER BY display_order
LIMIT 10;

-- Check custom polygon stored
SELECT table_number, shape, x, y, width, height,
       jsonb_array_length(custom_polygon) AS polygon_vertices
FROM tables
WHERE shape = 'CUSTOM'
ORDER BY created_at DESC
LIMIT 5;

-- Confirm only one cover per location
SELECT location_id, COUNT(*) FILTER (WHERE is_cover = true) AS covers
FROM media_items
WHERE is_active = true
GROUP BY location_id;
-- All values should be 0 or 1
```

---

## 🐛 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Sidebar "Media Gallery" missing | AdminSidebar.tsx not copied | Re-deploy modified file |
| Upload fails with 415 | Media type not in allowed list | Verify presign route updated with video MIMEs |
| Upload fails with 413 | File > 10MB | Default cap; raise via `AWS_S3_MAX_UPLOAD_BYTES` env var |
| Polygon button missing | Toolbar.tsx not updated | Re-deploy |
| Polygon doesn't close on first click | < 3 points placed | Need at least 3 vertices |
| Custom polygon vanishes after reload | customPolygon not in API | Verify tables/route.ts has the customPolygon schema |
| "Cover photo" toggle does nothing | Unique constraint conflict | Likely a stale record — run cleanup SQL in test 12 |

---

## 📋 What's in this drop vs. Phase 3c

### ✅ Delivered (Phase 3b)
- Media gallery: upload, view, set cover, caption, alt text, mark 360°, soft delete
- Custom polygon shapes in floor plan editor (draw mode + render + save)
- Sidebar entry for Media Gallery
- Per-section media support (DB only — UI in Phase 3c)

### ⏭️ Coming in Phase 3c (next session, ~3-4 days)
- **360° photo viewer** using Pannellum (interactive panorama)
- **Multi-scene virtual tour** — link 360° panoramas with navigation hotspots
- **Table hotspots inside 360° views** — click a table while in virtual tour → opens booking flow
- **Embeddable iframe** for restaurant websites (Zillow-style virtual walkthrough)
- **Mobile gyroscope support** for natural 360° viewing on phones

### ⏭️ Phase 4 (then)
- Live floor view for staff (table status colors, tap to start order)

### ⏭️ Phase 5+
- Reservations module
- White-label customer booking page (uses everything from Phase 3)
- Google Business Profile integration
- WhatsApp full POS

---

## ✅ Sign-off

When Tests 1-12 all pass → reply "Phase 3b green" and I start **Phase 3c** (the killer feature — multi-scene virtual tour).

If anything breaks → paste failing test number + error + relevant logs:
```powershell
pm2 logs itap-app --nostream --lines 50 | Select-String "media|polygon|MediaItem|floor-plan"
```
