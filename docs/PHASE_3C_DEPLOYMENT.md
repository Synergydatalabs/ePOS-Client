# Phase 3c Deployment — Virtual Tour (360° + Hotspots + Embeddable)

**Date**: 2026-05-18
**Scope**: The killer feature — Zillow-style virtual restaurant tour. 360° panorama viewing with multi-scene navigation, table-link hotspots for booking, embeddable iframe for any website.

**Prerequisites**: Phase 1 (DB + S3) + Phase 2 (floor plan) + Phase 3a + Phase 3b (media gallery) all deployed.

---

## ✨ What ships in this phase

### Customer-facing
- 🌐 **Public tour URL**: `/tour/<slug>` (e.g., `oreugo.ca/tour/arabicbeans-downtown`)
- 🖼 **360° panoramic viewer** with drag-to-look-around (mouse + touch)
- 📱 **Mobile gyroscope** support (look around by moving phone)
- 🔗 **Multi-scene navigation** via SCENE_LINK hotspots ("walk" between rooms)
- 🪑 **Click table inside tour** to start booking (TABLE_LINK hotspots)
- 📄 **External link** hotspots (menu PDF, website, etc.)
- ℹ️ **Info popup** hotspots
- 🖼 **Scene selector** chips at bottom (one-tap scene change)
- 🎨 **Color-coded hotspots** with legend

### Admin
- ⚙️ **Tour editor** at `/dashboard/admin/virtual-tour`
- 🎯 **Click-to-place** hotspots inside the 360° viewer
- 📝 **Hotspot type picker**: Walk / Table / Info / External Link
- ⭐ **Default scene** picker (where the tour starts)
- 🔗 **Copyable public URL** + iframe embed code
- 📋 **Scene overview grid** with thumbnails

### Embed-friendly
- 🎁 **`<iframe>` support** with `?embed=1` mode (hides headers)
- 📡 **PostMessage events** when customer selects a table inside an embed
- 🌍 **CORS-enabled** public API (`/api/public/tour/<slug>`)

---

## 🗄️ Database changes — REQUIRED

Run **this** SQL migration on Aurora:
```
prisma/migrations/manual/2026-05-18_phase3c_virtual_tour.sql
```

Creates:
- `hotspot_type` enum (`SCENE_LINK`, `TABLE_LINK`, `INFO`, `EXTERNAL_URL`)
- `tour_hotspots` table — hotspots placed inside 360° scenes
- `media_items.is_default_scene` column (one default per location)
- `locations.public_tour_slug` column — auto-populated from existing names
- Partial unique indexes (one default scene per location, unique slug across all locations)
- `updated_at` trigger
- CHECK constraint enforcing hotspot type matches populated target field

**Auto-generates** `public_tour_slug` values from existing location names. If two locations end up with same slug (rare), it suffixes with first 8 chars of the location UUID. **Manually rename later** if you want prettier slugs.

Backup Aurora first. The SQL is wrapped in `BEGIN`/`COMMIT`.

After SQL succeeds, on EC2:
```powershell
npx prisma generate
```

---

## 📦 Files to copy (12 new + 4 modified)

### New files
```
prisma/migrations/manual/2026-05-18_phase3c_virtual_tour.sql
src/lib/virtual-tour/types.ts

src/app/api/tenants/[tenantId]/locations/[locationId]/tour/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/tour/scenes/[mediaId]/hotspots/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/tour/scenes/[mediaId]/hotspots/[hotspotId]/route.ts
src/app/api/public/tour/[slug]/route.ts

src/components/virtual-tour/PannellumViewer.tsx
src/components/virtual-tour/VirtualTourViewer.tsx
src/components/virtual-tour/TourSceneEditor.tsx

src/app/dashboard/admin/virtual-tour/page.tsx
src/app/tour/[slug]/page.tsx

docs/PHASE_3C_DEPLOYMENT.md
```

### Modified files
```
prisma/schema.prisma                     (TourHotspot + MediaItem + Location updates)
src/components/admin/AdminSidebar.tsx    (Virtual Tour sidebar link)
src/middleware.ts                        (public /tour + /api/public exempt from auth)
package.json + package-lock.json         (pannellum dependency)
```

### Folders to create on EC2
```powershell
mkdir src\lib\virtual-tour
mkdir src\components\virtual-tour
mkdir src\app\dashboard\admin\virtual-tour
mkdir src\app\tour\[slug]
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\tour"
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\tour\scenes\[mediaId]\hotspots\[hotspotId]"
mkdir "src\app\api\public\tour\[slug]"
```

### npm packages
```
pannellum  ← new
```

---

## 🚀 Deploy sequence

```powershell
cd C:\ZASHX-APPs\tap-app

# 1. Backup Aurora (snapshot)
# 2. Run SQL migration on Aurora

# 3. On EC2:
git pull            # or copy 16 files
npm install         # installs pannellum

# 4. Regenerate Prisma client
npx prisma generate

# 5. Clean rebuild
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build

# 6. Restart
pm2 restart itap-app
pm2 logs itap-app --lines 30
```

---

## 🧪 Test plan (15 min)

### Setup — get a 360° panorama (3 min)

Phase 3c needs equirectangular 360° images (2:1 aspect ratio). Easy sources:
- **Sample**: Download from https://pannellum.org/images/cerro-toco-0.jpg (small test image)
- **Real**: Insta360, Theta, Polycam apps export them
- **Free**: Many on https://polyhaven.com/hdris (download .hdr → convert to .jpg)

For testing, save 2 panoramas to your computer.

### Test 1 — Upload 360° panoramas as scenes (2 min)
1. Navigate to **Media Gallery** (`/dashboard/admin/restaurant-media`)
2. Upload your 2 panorama JPGs
3. Click first one → in detail dialog, click **"Mark as 360° panorama"**
4. Type scene name: `Entrance` → OK
5. ✅ **Expected**: Purple "360°: Entrance" badge appears on tile
6. Repeat for second panorama → name it `Dining Room`

### Test 2 — Virtual Tour sidebar link (30 sec)
1. Look at left sidebar
2. ✅ **Expected**: "Virtual Tour" item visible (below Media Gallery)
3. Click → navigates to `/dashboard/admin/virtual-tour`

### Test 3 — Tour editor loads (1 min)
1. Help dropdown expanded (collapsible explainer)
2. Public URL section visible with copyable URL
3. Embed code section with iframe snippet
4. Scenes overview shows both your panoramas with thumbnails
5. ✅ **Expected**: Editor pane at bottom — scene picker chips, viewer, "Add hotspot" button

### Test 4 — Set default scene (30 sec)
1. In Scenes overview grid, click **"Set default"** on Entrance
2. ✅ **Expected**: Entrance shows yellow "★ DEFAULT" badge

### Test 5 — Place a SCENE_LINK hotspot (3 min)
1. In editor, scene picker → click "Entrance"
2. Drag the 360° viewer to look around the panorama
3. Click the **"Add hotspot"** button → top bar shows "Click anywhere in the panorama to place a hotspot"
4. Click on a doorway or path in the panorama
5. ✅ **Expected**: Dialog opens with yaw/pitch prefilled
6. Set:
   - Type: "Walk to another scene"
   - Label: "Go to Dining Room"
   - Target scene: Dining Room
7. Click **Add**
8. ✅ **Expected**:
   - Toast: "Hotspot added"
   - Hotspot list (right side) shows new entry
   - Indigo dot appears in the 360° viewer at click position

### Test 6 — Click the hotspot (1 min)
1. Click the indigo dot you just placed
2. ✅ **Expected**: Edit dialog opens (clicking hotspot in editor mode = edit)
3. Cancel for now

### Test 7 — Place a TABLE_LINK hotspot (2 min)
1. Add hotspot → click on a table area in the panorama
2. Type: "Book a table"
3. Label: "Book Window Booth"
4. Target table: pick any table from dropdown
5. Add
6. ✅ **Expected**: Amber dot appears at click position

### Test 8 — Add scene navigation in the other direction (1 min)
1. Switch to "Dining Room" scene
2. Add hotspot → click somewhere → Type: "Walk to scene", Label: "Back to entrance", Target: Entrance
3. ✅ **Expected**: Saves successfully

### Test 9 — View public URL (2 min)
1. In tour editor, copy the Public URL (e.g., `https://itap.zashx.com/tour/arabicbeans-downtown`)
2. Open in NEW incognito window (no auth)
3. ✅ **Expected**:
   - Tour loads on dark page with restaurant name header
   - Default scene (Entrance) shows
   - You can drag to look around
   - Hotspots visible (indigo for scene, amber for table)
   - Bottom shows scene selector chips
   - Bottom shows legend ("Walk here" indigo, "Book this table" amber, etc.)

### Test 10 — Multi-scene navigation (1 min)
1. Hover over the "Go to Dining Room" hotspot → tooltip shows label
2. Click it
3. ✅ **Expected**: Scene switches to Dining Room. You see the "Back to entrance" hotspot.
4. Click that → returns to Entrance ✓

### Test 11 — Mobile gyroscope (optional, 1 min)
1. Open public URL on phone (Chrome / Safari)
2. ✅ **Expected**: Granted gyroscope permission prompt (on iOS Safari)
3. Move phone around
4. ✅ **Expected**: View follows phone orientation

### Test 12 — Iframe embed (1 min)
1. Copy embed code from tour editor
2. Create a test HTML file on your computer:
   ```html
   <!DOCTYPE html>
   <html>
   <body>
     <h1>My Restaurant Website</h1>
     <p>Check out our 360° tour:</p>
     <!-- PASTE EMBED CODE HERE -->
   </body>
   </html>
   ```
3. Open the file in browser
4. ✅ **Expected**: Tour loads inside iframe. Header/footer hidden (embed mode).

### Test 13 — Table selection via embed (postMessage) (1 min)
1. In the same test HTML, add a script:
   ```html
   <script>
     window.addEventListener('message', (e) => {
       if (e.data.type === 'oreugo:tour:table-selected') {
         alert('Table selected: ' + e.data.tableNumber);
       }
     });
   </script>
   ```
2. Reload, click a TABLE_LINK hotspot
3. ✅ **Expected**: Alert shows table number — parent page received the postMessage

### Test 14 — DB verification (1 min)
```sql
SELECT COUNT(*) FROM tour_hotspots;
-- Should match number of hotspots you created

SELECT s.scene_name, COUNT(h.id) AS hotspots
FROM media_items s
LEFT JOIN tour_hotspots h ON h.scene_media_id = s.id
WHERE s.media_type = 'PANORAMA_360'
GROUP BY s.id, s.scene_name;

-- Verify default scene
SELECT scene_name, is_default_scene FROM media_items
WHERE media_type = 'PANORAMA_360' AND is_active = true;

-- Verify slug is unique
SELECT public_tour_slug, COUNT(*) FROM locations GROUP BY public_tour_slug HAVING COUNT(*) > 1;
-- Should return 0 rows
```

---

## 🐛 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Pannellum doesn't load (empty black box) | Missing dep | `npm install pannellum` |
| 360° image looks "stretched" | Wrong aspect ratio | Image must be equirectangular (2:1 — like 4000×2000) |
| Hotspot click does nothing | Frontend JS error | Browser console for errors |
| "Tour not found" 404 on public URL | Slug mismatch | Verify `locations.public_tour_slug` matches URL |
| Tour shows "No 360° scenes yet" | No media marked as panorama | Go to Media Gallery → mark a photo as 360° with scene name |
| Default scene doesn't show first | Multiple defaults? | DB partial unique index prevents this; refresh page |
| Iframe blocked by CSP | Restaurant's own site has strict CSP | They need to add your domain to `frame-src` |
| Mobile gyroscope doesn't work | iOS requires permission | Tap viewer once first to grant permission |

---

## 📐 360° image preparation tips for restaurants

Tell your restaurant customers:

**Recommended cameras** (cheapest to fanciest):
- Phone with Polycam app (~free) — decent quality
- Insta360 ONE X3 (~$500) — easy, great results
- Theta Z1 (~$1000) — professional
- Matterport Pro (~$3000) — overkill, only if budget

**Capture tips**:
- Use a tripod (eye-level, ~5ft 8in)
- Pick one spot per "scene" (entrance, middle of dining, bar, patio)
- Even lighting (avoid sun glare from windows)
- Stand still while capturing
- Final image should be 2:1 aspect ratio (e.g., 4096×2048 px)

**Upload to Media Gallery**:
- File format: JPG (smaller) or PNG (better quality, larger)
- Max 10MB by default — increase via `AWS_S3_MAX_UPLOAD_BYTES` if needed for 8K panoramas

---

## ⏭️ What's next

### Phase 4 (next session)
- **Live floor view for staff** — real-time table status colors, tap to start order, server color-coding, turn-time progress bar

### Phase 5
- **Reservations module** — 3-tap booking flow, calendar, SMS/WhatsApp confirmations

### Phase 6
- **White-label customer booking page** at `/book/<slug>` — combines floor plan, photo gallery, virtual tour, and reservation flow into one beautiful page

### Phase 7+
- Google Business Profile integration
- WhatsApp Business POS

---

## ✅ Sign-off

When Tests 1-14 all pass → reply "Phase 3c green" and I start Phase 4 (live floor view for staff).

If anything fails → paste:
1. Test number
2. Error/screenshot
3. Browser console errors (F12)
4. `pm2 logs itap-app --nostream --lines 50 | Select-String "tour|hotspot|pannellum"`
