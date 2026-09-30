# Phase 4 Deployment — Live Floor View for Staff

**Date**: 2026-05-18
**Scope**: Real-time floor view used by host/servers during service. Read-only canvas showing live table status with color-coded states, server assignment, and one-tap actions (seat guests, mark clean, hold for reservation).

**Plus**: UI fix — admin dashboard wrapper no longer pads canvas-based tools, so the floor plan editor uses full width.

**Prerequisites**: Phase 1+2+3 (a+b+c) all deployed.

---

## ✨ What ships

### Staff-facing live floor view (`/dashboard/pos/floor-view`)
- 🟢 **Color-coded table tiles** by status:
  - White = Available
  - Server's color = Occupied (Toast pattern — each server has unique color)
  - Purple = Reserved
  - Amber = Cleaning
  - Gray = Blocked
- 👤 **Server initials badge** on each occupied table
- ⏱️ **Time-since-seated** counter + turn-time progress bar
- 💰 **Live $ spent** if order in progress
- 👥 **Guest count** displayed on occupied tables
- 📅 **Reservation chit auto-pops** when an upcoming reservation matches the clicked table
- 🎯 **One-tap actions** drawer (right side):
  - AVAILABLE → Seat (with party size) | Hold for reservation | Block
  - OCCUPIED → Open order | Mark as cleaning
  - CLEANING → Mark available
  - RESERVED → Seat now | Release
  - BLOCKED → Unblock
- 🏷️ **Server assignment dropdown** (change anytime)
- 🔄 **Auto-refresh every 5 seconds** (no WebSocket — simple polling)
- 📊 **Top stats bar** showing live counts per status + total guests
- 🏢 **Multi-floor switcher** if location has multiple floor plans

### UI fix
- Canvas-based admin pages (floor plan, virtual tour, live floor view) no longer get the default 32px page padding from the dashboard layout. They span edge-to-edge inside `<main>`. Fixes the wasted-space issue you screenshotted.

---

## 🗄️ Database changes — REQUIRED

Run on Aurora:
```
prisma/migrations/manual/2026-05-18_phase4_live_floor_view.sql
```

Creates:
- `memberships.color` (per-staff hex color — auto-assigned to existing staff)
- `tables.current_server_id` (which server "owns" this table now)
- `tables.seated_at` (drives turn-time bar)
- `tables.guest_count`
- `tables.last_status_change_at`
- Trigger: bumps `last_status_change_at` on status change; clears seated/server fields when reverting to AVAILABLE
- Index: `idx_tables_live_status` for floor view queries

After SQL succeeds, on EC2:
```powershell
npx prisma generate
```

---

## 📦 Files to copy (13 new + 4 modified)

### New files
```
prisma/migrations/manual/2026-05-18_phase4_live_floor_view.sql
src/lib/floor-view/types.ts

src/app/api/tenants/[tenantId]/locations/[locationId]/floor-view/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/floor-view/tables/[tableId]/status/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/floor-view/tables/[tableId]/assign-server/route.ts

src/components/floor-view/LiveTableTile.tsx
src/components/floor-view/LiveCanvasStage.tsx
src/components/floor-view/TableActionsDrawer.tsx
src/components/floor-view/LiveFloorView.tsx

src/app/dashboard/pos/floor-view/page.tsx

docs/PHASE_4_DEPLOYMENT.md
```

### Modified files
```
prisma/schema.prisma                     (Membership.color, Table.currentServerId/seatedAt/guestCount/lastStatusChangeAt)
src/components/admin/AdminSidebar.tsx    (Live floor view sidebar item)
src/app/dashboard/layout.tsx             (FULL_WIDTH_ROUTES opt-out from padding — UI fix)
```

### Folders to create on EC2
```powershell
mkdir src\lib\floor-view
mkdir src\components\floor-view
mkdir src\app\dashboard\pos\floor-view
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\floor-view"
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\floor-view\tables\[tableId]\status"
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\floor-view\tables\[tableId]\assign-server"
```

### npm packages
**None new.** (Konva already installed in Phase 2.)

---

## 🚀 Deploy sequence

```powershell
cd C:\ZASHX-APPs\tap-app

# 1. Backup Aurora (snapshot)
# 2. Run SQL migration on Aurora

# 3. On EC2:
git pull
npx prisma generate
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
pm2 restart itap-app
```

---

## 🧪 Test plan (10 min)

### Setup
1. Have a floor plan with at least 3-4 tables saved (Phase 2/3 work)
2. Make sure your test admin user has POS_STAFF or higher role
3. (Optional) Create a second test user — different "server" so you can swap

### Test 1 — UI fix verification (30 sec)
1. Navigate to `/dashboard/admin/floor-plan`
2. ✅ **Expected**: Canvas + toolbar span edge-to-edge of main content area. No giant gap on the left.
3. Compare to before screenshot — now should look much more balanced.

### Test 2 — Live floor view sidebar link (30 sec)
1. Sidebar → expand "Tables"
2. ✅ **Expected**: 3 items now — Tables list, Floor plan (edit), **Live floor view**
3. Click "Live floor view" → navigates to `/dashboard/pos/floor-view`

### Test 3 — Live view loads (1 min)
1. ✅ **Expected**:
   - "Live Floor" page header
   - Top stats bar: Available / Seated / Reserved / Cleaning / Blocked counts
   - "Total guests: 0"
   - Canvas with your tables rendered in WHITE (Available status)
   - Right side: "Tap a table on the floor to see actions"
   - Bottom-right of stats: "Auto-refresh every 5s" indicator

### Test 4 — Click a table (1 min)
1. Click any table on the canvas
2. ✅ **Expected**: Right drawer changes to show:
   - "Table [number]" header with "Available" badge
   - Capacity
   - "Assigned server" dropdown (with all your staff listed)
   - "Party size" input (default 2)
   - Green "Seat guests" button
   - Other action buttons (Hold for reservation, Block)

### Test 5 — Seat guests (1 min)
1. Set party size to 4
2. Click "Seat guests"
3. ✅ **Expected**:
   - Toast: "Table N → Seated"
   - Table tile changes color from white to green (or your server's color if assigned)
   - Shows "4 guests" + time counter "0m"
   - Server initials appear in top-right of tile if you set one
   - Stats at top update: Available -1, Seated +1, Total guests +4
   - Turn-time progress bar starts thin at the bottom

### Test 6 — Assign server (30 sec)
1. With seated table selected, pick a server from dropdown
2. ✅ **Expected**:
   - Toast: "Server assigned"
   - Table tile fill changes to server's assigned color
   - Server initials badge appears top-right

### Test 7 — Mark cleaning (30 sec)
1. Click "Guests left → Cleaning"
2. ✅ **Expected**:
   - Tile turns yellow/amber
   - Status badge "Cleaning"
   - Guest count + time disappear
   - Stats update

### Test 8 — Mark available (15 sec)
1. Click "Cleaned → Available"
2. ✅ **Expected**: Tile back to white. Available status. Stats reset.

### Test 9 — Reserve flow (45 sec)
1. Available table → Click "Hold for reservation"
2. ✅ **Expected**: Tile turns purple. Status "Reserved".
3. Click again → drawer shows "Seat reservation" button
4. Set party size → Click → tile turns green/server-color

### Test 10 — Multiple tables at once (1 min)
1. Seat 3 different tables with different guest counts
2. ✅ **Expected**: All 3 tables show different colors based on assigned servers
3. Top bar shows correct totals
4. Each table has its own turn-time counter (different "Xm" values)

### Test 11 — Auto-refresh (2 min)
1. Open a second browser tab on same floor view URL
2. In tab 1, seat a table
3. Wait up to 5 seconds
4. ✅ **Expected**: Tab 2 updates automatically (no manual refresh needed)
5. Watch the "Auto-refresh" spinner in top bar flicker every 5s

### Test 12 — Reservation chit (optional — needs reservations in DB)
1. Create a reservation in DB (or via Phase 5 when shipped) for a specific table in the next 2 hours
2. Click that table on floor view
3. ✅ **Expected**: Purple "Upcoming reservation" panel shows in drawer with customer name, party size, time, special occasion

### Test 13 — DB verification (1 min)
```sql
-- Verify server colors assigned
SELECT first_name, last_name, role, color FROM memberships
WHERE color IS NOT NULL
LIMIT 10;

-- Check live status changes are tracked
SELECT table_number, status, current_server_id, seated_at, guest_count, last_status_change_at
FROM tables
WHERE status != 'AVAILABLE'
ORDER BY last_status_change_at DESC
LIMIT 5;

-- Trigger working correctly: when status → AVAILABLE, fields are cleared
UPDATE tables SET status = 'OCCUPIED', seated_at = NOW(), guest_count = 4
WHERE id = (SELECT id FROM tables WHERE is_active LIMIT 1)
RETURNING table_number, status, seated_at, guest_count;
-- Should show seated_at populated

UPDATE tables SET status = 'AVAILABLE' WHERE id = (SELECT id FROM tables WHERE is_active LIMIT 1)
RETURNING table_number, status, seated_at, guest_count;
-- seated_at, guest_count, current_server_id should all be NULL (cleared by trigger)
```

---

## 🐛 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| All tables show in white even after seating | Status not updating | Check pm2 logs for `[table status POST]` errors |
| Auto-refresh stopped | JS error | F12 → console; reload page |
| Server color not showing on tile | Membership has no color | Run the auto-assign SQL from migration |
| "Server initials" empty | Server has no firstName/lastName | Add a name in admin → Team |
| Stats counts wrong | Stale data | Click "Refresh now" link in top bar |
| Live view 403 on POS_STAFF user | Auth gating | We use POS_STAFF as the minimum; ensure user has at least that role |
| Floor plan editor still has gap | Layout.tsx not deployed | Hard refresh; clear .next; rebuild |

---

## 🏗️ Architecture notes

- **No WebSocket** — simple polling every 5 sec. For a restaurant with <50 tables, this is plenty efficient. WebSocket can be added later if multi-tablet concurrent editing becomes a bottleneck.
- **Status changes go through API** — never direct DB writes from frontend. The Phase 4 DB trigger ensures consistency (clearing seat/guest/server when status returns to AVAILABLE).
- **Konva for rendering** — same library as floor plan editor. Tables render the same shapes. Means custom polygons from Phase 3b also work here.
- **Server colors deterministic** — migration assigns colors via row order. New staff added later get unset color until manager updates (future admin UI).
- **Reservations filtered "next 2 hours"** — keeps payload small. Phase 5 will add more sophisticated time-window logic.

---

## ⏭️ Coming in Phase 5

When you confirm Phase 4 works:
- **Reservations module** — 3-tap booking flow, calendar, SMS/WhatsApp confirmations
- This makes the "Upcoming reservation" chit on the floor view fully functional
- Customer-facing reservation page (also Phase 6)

About 3-4 days of work.

---

## ✅ Sign-off

When Tests 1-13 pass → reply "Phase 4 green" and I'll start Phase 5 (reservations).

If issues → paste failing test + error + relevant logs:
```powershell
pm2 logs itap-app --nostream --lines 50 | Select-String "floor-view|table|status"
```
