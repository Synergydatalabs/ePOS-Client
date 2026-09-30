# Phase 5a Deployment — Reservations Admin (List + Calendar + 3-Tap Create)

**Date**: 2026-05-18
**Scope**: Reservation management admin — list view, week calendar view, 3-tap quick-create flow, guest profile autocomplete, special dates / block-out support, status transitions.

**Prerequisites**: Phase 1 (DB) + Phase 2 (floor plan) + Phase 4 (live floor view) all deployed. Phase 1a already created the `reservations`, `guest_profiles`, `waitlist_entries`, and `special_dates` tables.

---

## ✨ What ships

### Reservations admin (`/dashboard/admin/reservations`)
- 📋 **List view** — grouped by day, click row → detail dialog
- 📅 **Calendar view** — 7-day week grid with hourly rows, click cell to create
- 🎯 **3-tap quick create**: Time → Party size → Guest (≤15 sec for typical booking)
- 🔍 **Guest autocomplete** — search by phone/email/name, auto-link existing profiles
- 👤 **Inline new guest creation** — first/last/phone/email in the same flow
- 🎉 **Common occasion chips** — Birthday, Anniversary, Date night, etc.
- ⚡ **One-tap status transitions** — Mark arrived / Seat / Complete / No-show
- ✏️ **Full edit dialog** — change time, party, table, notes
- ❌ **Soft cancel with reason** — preserves history for reporting
- 🚫 **Special date block-out enforcement** — server rejects bookings on blocked dates
- 🔄 **Auto-link to existing guest profile** when phone/email matches

### Status filter chips
Toggle which statuses appear in list/calendar:
- Confirmed, Arrived, Seated, Completed, No-show, Cancelled
- Default shows: Confirmed + Arrived + Seated

### Calendar week navigation
- ← / → week buttons
- "This week" jump button
- Click empty cell → quick create dialog with time pre-filled

---

## 🗄️ Database changes — NONE

The schema for reservations, guest_profiles, waitlist_entries, and special_dates was created in Phase 1a. This phase only adds API + UI.

If you didn't run Phase 1a's SQL yet, check:
```sql
SELECT tablename FROM pg_tables WHERE tablename IN ('reservations', 'guest_profiles', 'special_dates');
-- Should return 3 rows
```

---

## 📦 Files to copy (10 new + 1 modified)

### New files
```
src/lib/reservations/types.ts

src/app/api/tenants/[tenantId]/locations/[locationId]/reservations/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/reservations/[reservationId]/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/guest-profiles/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/special-dates/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/special-dates/[dateId]/route.ts

src/components/reservations/CreateReservationDialog.tsx
src/components/reservations/ReservationList.tsx
src/components/reservations/ReservationCalendar.tsx
src/components/reservations/ReservationDetailDialog.tsx

src/app/dashboard/admin/reservations/page.tsx

docs/PHASE_5A_DEPLOYMENT.md
```

### Modified files
```
src/components/admin/AdminSidebar.tsx   (Reservations sidebar link)
```

### Folders to create on EC2
```powershell
mkdir src\lib\reservations
mkdir src\components\reservations
mkdir src\app\dashboard\admin\reservations
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\reservations\[reservationId]"
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\guest-profiles"
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\special-dates\[dateId]"
```

### npm packages
**None new.**

---

## 🚀 Deploy sequence

```powershell
cd C:\ZASHX-APPs\tap-app
git pull               # or copy files
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
pm2 restart itap-app
pm2 logs itap-app --lines 30
```

No DB migration this time — just code.

---

## 🧪 Test plan (10 min)

### Test 1 — Sidebar link (30 sec)
1. Sidebar → "Reservations" item visible (below Virtual Tour)
2. Click → navigates to `/dashboard/admin/reservations`

### Test 2 — Empty state (30 sec)
1. New tenant with no reservations
2. ✅ **Expected**: "No reservations in this date range" message, with date range header

### Test 3 — 3-tap create (2 min)
1. Click **"+ New reservation"** button (top right)
2. Dialog opens — Step 1 of 3 (Time)
3. Date defaults to today; click "Tomorrow" chip
4. Click a time slot (e.g., 7:00 PM)
5. Click **Next →**
6. Step 2: click party size "4"
7. Click **Next →**
8. Step 3: in guest search, type "Test"
9. No existing match — fill new guest:
   - First name: "Test"
   - Phone: "555-1234"
10. (Optional) Click "Birthday" chip for occasion
11. Click **Confirm reservation**
12. ✅ **Expected**: Toast "Reservation for Test confirmed", dialog closes, list shows your new reservation under "Tomorrow"

### Test 4 — Guest autocomplete (1 min)
1. Click + New reservation again
2. Time + party as before
3. In guest search, type "Test"
4. ✅ **Expected**: Test guest from previous step appears in dropdown with phone
5. Click it
6. ✅ **Expected**: Guest gets selected (indigo box, "Change" link)
7. Confirm

### Test 5 — List view + click row (1 min)
1. Reservations grouped by day (Today / Tomorrow / etc.)
2. Click a row
3. ✅ **Expected**: Detail dialog opens with all info

### Test 6 — Status transitions (2 min)
1. In detail dialog, click "Mark arrived"
2. ✅ **Expected**: Toast "Status → Arrived", dialog closes, list updates
3. Open same reservation again → "Seat now" button visible
4. Click → status becomes "Seated"
5. Click "Mark completed" → status becomes "Completed"
6. ✅ **Expected**: With default status filter (Confirmed + Arrived + Seated), the completed reservation hides
7. Add "Completed" chip to status filter → reservation reappears

### Test 7 — Edit reservation (1 min)
1. Open a reservation
2. Click **Edit**
3. Change party size to 6, add internal note "VIP — give them the window booth"
4. Click **Save**
5. ✅ **Expected**: Toast "Reservation updated", refresh shows new values

### Test 8 — Calendar view (1 min)
1. Click **Calendar** toggle
2. ✅ **Expected**: Week grid, today highlighted, your reservations show as colored chips in time slots
3. Click an empty cell at 6:00 PM tomorrow
4. ✅ **Expected**: Create dialog opens with date + time pre-filled (skip directly to Step 2)
5. Cancel out
6. Click **←** to go to previous week
7. ✅ **Expected**: Past week shows (empty if no historical data)
8. Click **This week** to return

### Test 9 — Cancel reservation (30 sec)
1. Open a reservation → click **Cancel**
2. Prompt asks for reason → type "Test cancel" or leave default
3. ✅ **Expected**: Toast "Reservation cancelled", reservation now shows with Cancelled status

### Test 10 — Status filter (30 sec)
1. Uncheck "Confirmed" chip
2. ✅ **Expected**: All confirmed reservations hidden from list
3. Re-check
4. ✅ **Expected**: They reappear

### Test 11 — DB verification (1 min)

```sql
-- Verify reservations created
SELECT customer_name, party_size, booked_for, status, source, special_occasion
FROM reservations
ORDER BY created_at DESC
LIMIT 10;

-- Verify auto-linked guest profile
SELECT r.customer_name, r.customer_phone, g.first_name, g.visit_count
FROM reservations r
LEFT JOIN guest_profiles g ON r.guest_profile_id = g.id
ORDER BY r.created_at DESC
LIMIT 10;

-- Status transitions tracked with timestamps
SELECT customer_name, status, arrived_at, seated_at, completed_at, cancelled_at, cancelled_reason
FROM reservations
WHERE arrived_at IS NOT NULL OR cancelled_at IS NOT NULL
ORDER BY updated_at DESC
LIMIT 5;
```

### Test 12 — Special date block (optional, 2 min)
1. Direct DB insert:
   ```sql
   INSERT INTO special_dates (location_id, date, label, block_reservations, public_message)
   VALUES (
     (SELECT id FROM locations LIMIT 1),
     CURRENT_DATE + INTERVAL '7 days',
     'Private buyout — corporate event',
     true,
     'Closed for a private event. Please book another date.'
   );
   ```
2. Try to create a reservation for that date via the UI
3. ✅ **Expected**: Error toast "Reservations blocked for this date: Private buyout..."

---

## 🐛 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Sidebar "Reservations" missing | AdminSidebar.tsx not copied | Re-deploy |
| 3-tap dialog won't advance | Time/party not picked | Check button states |
| Guest search returns nothing | < 2 chars or no matches | Type more |
| "Reservations blocked" on every date | Special date with blockReservations=true exists | Check `special_dates` table |
| Calendar empty even with reservations | Status filter excludes them | Toggle status chips |
| Status transitions disabled | Reservation already in COMPLETED/CANCELLED state | Use Edit to change |
| Edit doesn't save bookedFor | Datetime-local format issue | Browser locale; should work in Chrome/Edge/Safari |

---

## 🏗️ Architecture notes

- **3-tap flow** intentionally simple — Toast's reservation creation is universally complained about as too complex. Ours is 3 well-defined screens.
- **Guest profiles auto-linked** on phone/email match. If guest exists, reservation references their `guest_profile_id`; if not, a fresh profile is created on first reservation save.
- **No availability check** in v1 — staff can overbook. v2 (Phase 5b) will add real-time availability based on table capacity + open reservations. Reasoning: most real restaurants want staff judgment, not a strict system.
- **List view default range**: today + 30 days. Calendar view: 7 days at a time.
- **Status filter persisted** in client state only (not URL). Phase 5b may add URL persistence.
- **Soft cancel** preserves history for analytics + no-show tracking.

---

## ⏭️ Coming next — Phase 5b

When you confirm Phase 5a works, **Phase 5b** delivers:
- **Waitlist management** — walk-in queue with SMS notifications (1/9 reply for confirm/cancel)
- **SMS confirmations** for new reservations (Twilio integration)
- **WhatsApp confirmations** (Meta API)
- **Special dates admin UI** (currently only DB)
- **Section template** save/recall

About 3-4 days. After 5b, **Phase 6** ships the white-label customer-facing booking page.

---

## ✅ Sign-off

When Tests 1-12 pass → reply "Phase 5a green" and I'll start Phase 5b (waitlist + SMS).

If issues → paste:
1. Test number
2. Error/screenshot
3. PM2 logs: `pm2 logs itap-app --nostream --lines 50 | Select-String "reservations|guest-profile"`
