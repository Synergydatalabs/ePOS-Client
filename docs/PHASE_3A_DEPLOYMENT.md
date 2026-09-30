# Phase 3a — Floor Plan Editor Polish

**Date**: 2026-05-18
**Scope**: Background image, snap-to-grid, rotation/resize handles, autosave, version history, settings dialog, inline editing

**Prerequisite**: Phase 1a (DB schema) + Phase 1b/c (S3) + Phase 2 (floor plan editor) all deployed.

---

## ✨ What's new in this drop

| Feature | What it does |
|---|---|
| **Background image** | Upload architect drawing → renders as canvas underlay with opacity control |
| **Snap to grid** | Toggle in top bar — drag end snaps to nearest grid intersection |
| **Konva Transformer** | Selected table gets resize handles (corners) + rotation handle (top) |
| **Rotation snaps** | Rotation snaps to 15° increments (drag past for free rotation) |
| **Autosave** | Every 30 sec of inactivity, saves silently. Indicator shows "Autosaved 12s ago" |
| **Autosave toggle** | Top bar toggle if user wants manual-only save |
| **Version history** | Click history icon → modal lists all versions → restore button creates new version with snapshot |
| **Settings dialog** | Click gear icon → edit floor name, canvas size, grid size, BG image, BG opacity, delete floor |
| **Inline floor rename** | No more `prompt()` — Settings dialog handles it cleanly |

## 📁 Files (6 new + 4 modified, no DB changes)

### New files
```
src/components/floor-plan/BackgroundUploader.tsx
src/components/floor-plan/FloorSettingsDialog.tsx
src/components/floor-plan/VersionHistoryDialog.tsx
src/app/api/tenants/[tenantId]/locations/[locationId]/floor-plans/[floorPlanId]/versions/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/floor-plans/[floorPlanId]/restore/[versionNumber]/route.ts
docs/PHASE_3A_DEPLOYMENT.md
```

### Modified files
```
src/components/floor-plan/CanvasStage.tsx        (BG image + snap + Transformer)
src/components/floor-plan/TableShape.tsx         (id prop + onTransform handler)
src/components/floor-plan/FloorPlanEditor.tsx    (autosave, toggles, dialog wiring)
```

### New API directories needed
```powershell
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\floor-plans\[floorPlanId]\versions"
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\floor-plans\[floorPlanId]\restore"
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\floor-plans\[floorPlanId]\restore\[versionNumber]"
```

### Database
**No changes** — Phase 1a already created `floor_plan_versions`, `floor_plans.background_url`, `floor_plans.background_opacity` columns.

### npm packages
**No new packages** — `konva`, `react-konva`, `use-image` already installed in Phase 2.

---

## 🚀 Deploy on EC2

```powershell
cd C:\ZASHX-APPs\tap-app

# Sync the new + modified files (git pull OR manual copy of the 9 files listed above)

# No npm install needed (no new deps)

# Build + restart
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
pm2 restart itap-app
pm2 logs itap-app --lines 30
```

---

## 🧪 Test plan (15 min)

### Setup
1. Open `/dashboard/admin/floor-plan`
2. Use an existing floor plan (or create one)
3. Have a JPG/PNG of an architect's drawing ready (any image works for testing)

### Test 1 — Background image upload (3 min)

1. Click **gear icon** in top action bar → Settings dialog opens
2. Scroll to "Background image" section
3. Click **"Upload architect drawing"**
4. Pick your image
5. ✅ **Expected**: Progress bar fills, "Background image uploaded" toast
6. Drag opacity slider to 30%
7. Click "Save settings"
8. ✅ **Expected**: Canvas now shows your image as faint underlay behind the grid
9. Add a table on top
10. ✅ **Expected**: Table renders above the background

### Test 2 — Snap to grid (1 min)

1. Verify "Snap" toggle in top bar is checked
2. Drag a table around — release at a random spot
3. ✅ **Expected**: Table snaps to nearest grid intersection on drop
4. Uncheck "Snap" toggle
5. Drag again
6. ✅ **Expected**: Table stays exactly where dropped (free placement)

### Test 3 — Resize handles (2 min)

1. Click on a table → notice 8 small handles appear around it (4 corners + 4 sides + 1 rotation handle on top)
2. Drag a corner handle outward
3. ✅ **Expected**: Table resizes proportionally
4. Drag a side handle
5. ✅ **Expected**: Table stretches in that one dimension
6. Open inspector — width/height numbers reflect the new size

### Test 4 — Rotation (1 min)

1. Click a table — see the rotation handle (circle above the top edge)
2. Drag the rotation handle in an arc
3. ✅ **Expected**: Table rotates smoothly. Snaps every 15° (drag past for free rotation).
4. Release at ~45° angle
5. ✅ **Expected**: Table stays rotated. Inspector shows non-zero rotation value.

### Test 5 — Autosave (2 min)

1. Verify "Autosave" toggle in top bar is checked
2. Make a small change (move a table)
3. Wait 30 seconds without clicking anything
4. ✅ **Expected**:
   - "Unsaved changes" amber pill disappears
   - "Autosaved Xs ago" indicator appears (X starts small, grows over time)
   - No "Saved!" toast spam (autosave is silent)
5. Make another change
6. ✅ **Expected**: "Unsaved changes" reappears, autosave fires again in 30s

### Test 6 — Version history + restore (3 min)

1. Make some changes, click **Publish** → "Published version 2"
2. Make more changes, click **Publish** again → "Published version 3"
3. Click the **history icon** in top action bar
4. ✅ **Expected**: Dialog opens listing all versions (v3 marked "Current", v2 and earlier below)
5. Each version shows: number, date, who saved it, table count, sections count
6. Click **"Restore"** on version 2
7. Confirm dialog → click OK
8. ✅ **Expected**:
   - Toast: "Restored version 2 (now at version 4)"
   - Canvas reloads — looks like version 2 again
   - History now shows v4 as current (with note "Restored from version 2")

### Test 7 — Settings dialog (2 min)

1. Click **gear icon**
2. Change floor name from "Main Dining" to "Main Hall"
3. Change canvas width to 1600
4. Click "Save settings"
5. ✅ **Expected**: Floor tab updates to "Main Hall". Canvas is wider.
6. Open settings again → scroll to bottom → click "Delete this floor plan"
7. Confirm
8. ✅ **Expected**: Floor removed from tabs. If you had only one, returns to empty state.

### Test 8 — DB verification (1 min)

```sql
-- 1. Verify version snapshots exist
SELECT version_number, saved_at, note,
       jsonb_array_length(layout_json->'tables') AS tables
FROM floor_plan_versions
WHERE floor_plan_id = '<your-floor-id>'
ORDER BY version_number DESC LIMIT 10;

-- 2. Verify background image stored on floor plan
SELECT id, name, background_url, background_opacity, grid_size
FROM floor_plans
WHERE location_id = '<your-location-id>';

-- 3. Verify uploaded files tracked
SELECT filename, s3_key, resource_type, upload_status
FROM uploaded_files
WHERE resource_type = 'floor_plan_bg'
ORDER BY created_at DESC LIMIT 5;
```

---

## 🐛 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Background image doesn't load | CORS on S3 bucket | Verify CORS allows GET from itap.zashx.com (see Phase 1a) |
| Background image upload fails | IAM permissions | Verify IAM user has PutObject on bucket |
| Transformer handles don't appear | Konva node not found | Check browser console; the `id="table-X"` prop needs to match |
| Rotation jumps weirdly | Snap interval | Pull out of 15° snap zone — should free-rotate |
| Autosave never fires | Toggle off | Check the "Autosave" toggle in top action bar |
| Restore creates infinite tables | Tables created on each restore | Each restore creates new rows. Old tables are soft-deleted (is_active=false). This is intentional — auditable trail. |
| "Version not found" on restore | URL malformed | Version number is in URL path (`/restore/3`), not body |

---

## ⏭️ What's coming next

### Phase 3b (next session, ~2-3 days)
- Custom polygon shapes (L-tables, curved banquettes, freeform)
- Restaurant media gallery (photos, video)
- Per-section image galleries

### Phase 3c (after that, ~3 days)
- 360° photo viewer (Pannellum)
- Multi-scene virtual tour with hotspot navigation
- Table hotspots inside 360° views (click table → booking flow)

### Phase 4 (after Phase 3)
- Live floor view for staff (table status colors, tap to start order)

---

## ✅ Sign-off

When Tests 1-8 all pass → reply "Phase 3a green" and I start Phase 3b (custom shapes + media gallery).

If anything breaks → paste:
1. Test number that failed
2. Error message or screenshot
3. Browser console errors (F12)
4. `pm2 logs itap-app --nostream --lines 50 | Select-String "floor-plan|version|restore"`
