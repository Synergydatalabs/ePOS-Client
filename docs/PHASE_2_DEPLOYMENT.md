# Phase 2 Deployment Guide — Floor Plan Editor (base canvas)

**Date**: 2026-05-18
**Scope**: Visual floor plan editor with drag-drop tables, sections, multi-floor support, save & publish

**Prerequisite**: Phase 1a (DB schema) must be applied — provides `floor_plans`, `sections`, extended `tables` columns.

---

## 📁 Files added (13 total)

| File | Purpose |
|---|---|
| `prisma/schema.prisma` | (no changes — already added in Phase 1a) |
| `src/lib/floor-plan/types.ts` | Shared TS types + defaults (shape sizes, color presets) |
| `src/app/api/.../floor-plans/route.ts` | GET list, POST create |
| `src/app/api/.../floor-plans/[id]/route.ts` | GET, PATCH, DELETE |
| `src/app/api/.../floor-plans/[id]/publish/route.ts` | POST → snapshot + version bump |
| `src/app/api/.../floor-plans/[id]/tables/route.ts` | Bulk upsert/delete tables |
| `src/app/api/.../floor-plans/[id]/sections/route.ts` | GET, POST, bulk DELETE |
| `src/components/floor-plan/TableShape.tsx` | Konva primitive per shape kind |
| `src/components/floor-plan/CanvasStage.tsx` | Konva Stage with grid + tables |
| `src/components/floor-plan/Toolbar.tsx` | Left palette (shapes + section button) |
| `src/components/floor-plan/TableInspector.tsx` | Right sidebar — selected table props |
| `src/components/floor-plan/SectionPanel.tsx` | Modal for section management |
| `src/components/floor-plan/FloorSwitcher.tsx` | Top tabs for multi-floor |
| `src/components/floor-plan/FloorPlanEditor.tsx` | Main editor orchestrator |
| `src/app/dashboard/admin/floor-plan/page.tsx` | Page hosting the editor |
| `src/components/admin/AdminSidebar.tsx` | Sidebar link added |

Plus 3 new npm dependencies:
- `konva` (canvas engine)
- `react-konva` (React bindings)
- `use-image` (image loading helper, used in Phase 3 for BG images)

---

## 🚀 Deploy steps

```powershell
cd C:\ZASHX-APPs\tap-app
git pull        # or copy the new files

# Install the 3 new packages
npm install

# Full rebuild
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build

# Restart
pm2 restart itap-app
pm2 logs itap-app --lines 30
```

Look for "Ready in <X>ms" — no errors expected since Phase 1a already added the DB columns.

---

## 🧪 Manual testing

### Test 1 — Sidebar link appears

1. Open `/dashboard/admin/` in browser
2. Look at left sidebar → expand "Tables" → should show:
   - Tables list
   - **Floor plan** ← new
3. Click "Floor plan" → navigates to `/dashboard/admin/floor-plan`

### Test 2 — First-time empty state

1. On `/dashboard/admin/floor-plan` (assuming no floor plans yet for your active location)
2. ✅ **Expected**: "No floor plans yet" message + "Create floor plan" button
3. Click "Create floor plan" → prompt asks for name
4. Type "Main Dining" → click OK
5. ✅ **Expected**: Empty canvas loads, tab "Main Dining" appears, "0 tables · 0 sections"

### Test 3 — Add tables

1. Click the **Round** button in left palette
2. ✅ **Expected**: A round table labeled "1 / 4 seats" appears at canvas center, inspector opens on right
3. Click **Square** → second table appears (auto-numbered "2")
4. Click **Booth** → third table (auto-numbered "3")
5. Drag table 1 to a new position
6. ✅ **Expected**: Table moves smoothly; "Unsaved changes" amber pill appears at top
7. Click empty canvas area → table deselects, inspector shows empty state

### Test 4 — Edit table properties

1. Click on a table to select it
2. In inspector (right side):
   - Change Table number to "VIP-1"
   - Change Shape from Round to Rectangle
   - Change Capacity to 6
   - Toggle "Available for reservations" off
3. ✅ **Expected**: All changes reflect on canvas immediately. "Modified" badge appears at bottom of inspector.

### Test 5 — Create sections

1. Click **New section** button in left toolbar
2. Modal opens
3. Type "Bar" → pick orange color → click "Add section"
4. ✅ **Expected**: Section appears in modal's list below
5. Add another: "Patio" → green
6. Close modal
7. Click a table → in inspector, change "Section" dropdown to "Bar"
8. ✅ **Expected**: Table fill color changes to orange

### Test 6 — Save draft

1. Click **Save draft** button (top right)
2. ✅ **Expected**: "Saving..." → "Draft saved" toast → "Unsaved changes" pill disappears
3. Hard refresh browser (Ctrl+Shift+R)
4. ✅ **Expected**: All your tables, sections, and edits persist

### Test 7 — Publish

1. Make a small change (move a table)
2. Click **Publish** button
3. ✅ **Expected**: "Save and publish all pending changes?" confirm → click OK → "Published version 2" toast
4. Check in DB:
   ```sql
   SELECT version_number, saved_at, jsonb_array_length(layout_json->'tables') AS table_count
   FROM floor_plan_versions
   ORDER BY saved_at DESC
   LIMIT 5;
   ```
   ✅ Should see version row with correct table_count

### Test 8 — Multiple floors

1. Click **Add floor** in top tabs
2. Name it "Patio"
3. ✅ **Expected**: New empty tab opens
4. Add a few tables to Patio
5. Click back to "Main Dining" tab
6. ✅ **Expected**: Your Main Dining tables still there; Patio tables NOT visible (separate floors)
7. Save and publish each floor independently

### Test 9 — Delete a table

1. Select a table → click trash icon in inspector
2. ✅ **Expected**: Table disappears, "Unsaved changes" pill shows
3. Click **Save draft** → DB row marked inactive (soft delete)
4. Verify:
   ```sql
   SELECT table_number, is_active FROM tables WHERE is_active = false ORDER BY updated_at DESC LIMIT 5;
   ```

### Test 10 — Permissions check

1. Try accessing as a POS_STAFF user → should get 403 on save/publish
2. POS_MANAGER can read but not edit
3. POS_ADMIN+ can fully edit

---

## 🎯 What's in this drop vs. coming in Phase 3

### ✅ Working now (Phase 2)
- Multi-floor canvas with grid
- 5 table shapes (round, square, rectangle, booth, bar)
- Drag tables to position
- Select → edit number, label, capacity, shape, party size, section
- Section CRUD with color coding
- Save Draft (preserves work-in-progress)
- Publish (snapshots to versions for rollback later)
- Multi-floor switcher with unsaved-change indicator

### ⏭️ Coming in Phase 3 (~3 days work)
- 🖼 Background image upload (architect floor plans)
- 📐 Snap-to-grid (currently free placement)
- 🔄 Rotation handles (currently 0° only)
- 📜 Version history viewer + rollback UI
- 💾 Autosave (currently must click Save)
- ✏️ Inline floor name editing
- 🎨 Custom polygon shapes (currently 5 preset shapes)
- 📏 Alignment guides (red lines when aligned with other tables)

### ⏭️ Coming in Phase 4 (live floor view for staff)
- Real-time status (available/seated/dirty)
- Tap table → start order from POS
- Server color assignment
- Turn-time progress bar
- Reservation chit popup

---

## 🐛 Known limitations of Phase 2

1. **No resize handles** — table dimensions edited only in inspector (numeric inputs). Drag-to-resize comes in Phase 3.
2. **No rotation** — all tables at 0°. Add Phase 3.
3. **Grid is visual only** — doesn't snap. Phase 3.
4. **Canvas is fixed size** — set when creating the floor plan. Edit in DB or wait for Phase 3 settings dialog.
5. **One default floor per location** — extra floors are non-default. Toggle in DB or wait for Phase 3 UI.
6. **No undo** — once you save, changes are persisted. Use Publish for snapshots → restore via Phase 3 version history.

---

## 🔍 Database verification

After publishing a floor plan, you should see:

```sql
-- 1. Floor plan record
SELECT id, name, current_version, has_unsaved_changes, published_at
FROM floor_plans
WHERE location_id = '<your-location-id>';

-- 2. Sections
SELECT name, color, display_order
FROM sections
WHERE floor_plan_id = '<your-floor-plan-id>';

-- 3. Tables with positions
SELECT table_number, shape, x, y, width, height, section_id, is_active
FROM tables
WHERE floor_plan_id = '<your-floor-plan-id>'
ORDER BY z_index, table_number;

-- 4. Version history (after publishing)
SELECT version_number, saved_at,
       jsonb_array_length(layout_json->'tables') AS tables_count,
       jsonb_array_length(layout_json->'sections') AS sections_count,
       note
FROM floor_plan_versions
WHERE floor_plan_id = '<your-floor-plan-id>'
ORDER BY version_number DESC;
```

---

## 🔧 Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Page is blank / "Loading canvas..." forever | Konva failed to load | Check browser console for errors; verify `react-konva` is in package.json |
| "Floor plan not found" 404 | Location ID mismatch | localStorage `tap_active_location` doesn't match a real location |
| Tables don't save | 403 from API | User isn't POS_ADMIN — check membership role |
| Tables shift back after reload | Save didn't persist | Check pm2 logs for `[floor-plan tables save] error:` |
| Sidebar link missing | Sidebar cache | Ctrl+Shift+R to force reload; verify AdminSidebar.tsx has the new entry |
| Canvas tiny on big screens | Fixed canvas size | Edit `canvas_width` / `canvas_height` in DB or wait for Phase 3 |

### Helpful logs

```powershell
# All floor-plan related activity
pm2 logs itap-app --nostream --lines 200 | Select-String "floor-plan|section" -Context 0,5
```

---

## ⏭️ When you're ready for Phase 3

Reply with results from Tests 1-10. If most pass → I start Phase 3 (background image, snap, rotation, version history UI, autosave).

If you find specific issues → paste the error + which test, I'll fix before continuing.
