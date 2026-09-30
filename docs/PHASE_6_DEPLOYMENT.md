# Phase 6 Deployment — Public Customer Booking Page

**Date**: 2026-05-18
**Scope**: White-label public booking page at `/book/[tenantSlug]` and `/book/[tenantSlug]/[locationSlug]`. Combines photos, 360° tour link, live availability picker, and reservation flow — no auth required.

**Prerequisites**: Phase 1-5d deployed. **Same SQL migration** as Phase 5d covers Phase 6 too — run it once.

---

## ✨ What ships

### Public landing — `/book/[tenantSlug]`
- Server-rendered for SEO
- Shows tenant logo + tagline + grid of bookable locations
- If only ONE location, auto-redirects to detail page
- Uses tenant branding colors from `TenantSettings.brandPrimaryColor`
- Cached at edge for 60s (ISR)

### Location detail — `/book/[tenantSlug]/[locationSlug]`
- Photo gallery (up to 12 photos, scrollable thumbs, click-to-lightbox)
- Address + phone (tel: link on mobile)
- "Take a 360° tour" chip if the location has any PANORAMA_360 media (opens existing `/tour/[slug]` in new tab)
- Sticky right-rail booking flow on desktop, stacked on mobile

### Booking flow (client-side)
- **Step 1**: party size selector + date picker (date range = today → tenant.advanceDays)
- **Step 2**: live time-slot grid (refetches when date or party size changes)
- **Step 3**: guest name, phone, optional email, special occasion chips, notes
- **Step 4**: confirmation screen with booking code + summary
- Closed-date detection: special dates with `blockReservations` or `blockOnline` are red-flagged with the public message
- Honey-pot anti-bot field (hidden from real users, invisible bots fill it)
- Server-side recheck: slot must STILL be available at submit (handles race condition)
- Sends WhatsApp confirmation (if tenant has Meta creds) or SMS fallback
- Marks `confirmation_sent_at` so the 5d reminder cron doesn't duplicate

### Public APIs
```
GET  /api/public/book/[tenantSlug]                                            → tenant + locations
GET  /api/public/book/[tenantSlug]/locations/[locationSlug]                   → location detail
GET  /api/public/book/[tenantSlug]/locations/[locationSlug]/availability      → ?date&partySize → slots
POST /api/public/book/[tenantSlug]/locations/[locationSlug]/reserve           → create reservation
```

### Availability engine — `src/lib/booking/availability.ts`
- Reads `locations.operating_hours` JSON (default 11:00–22:00 if null)
- Reads `special_dates` table for date-specific overrides
- Computes per-slot remaining capacity = sum(active+bookable table.capacity) − sum(overlapping reservation.partySize)
- Filters slots earlier than `now + bookingLeadMinutes`
- Filters parties > `bookingMaxPartySize`

### Rate limit + anti-abuse
- 5 reservations per IP per hour (in-memory window; resets on process restart)
- Honey-pot field hidden via CSS — bots fill anything they see
- HTTP 429 if exceeded
- HTTP 409 + `retry: true` if the slot was grabbed by another guest mid-form

---

## 🗄️ Database changes

**Same migration as Phase 5d** — `2026-05-18_phase5d_phase6_meta_creds_and_booking.sql`. Already covers:

- `locations.public_booking_enabled` (default TRUE)
- `locations.public_booking_slug` (auto-backfilled from `public_tour_slug` on existing rows)
- `locations.operating_hours` (JSONB, default NULL = 11:00–22:00)
- `locations.booking_lead_minutes` (default 60)
- `locations.booking_slot_minutes` (default 30)
- `locations.booking_max_party_size` (default 12)
- `locations.booking_hero_media_id` (optional featured photo)
- `tenants.public_booking_enabled` (default TRUE)
- `tenants.booking_tagline` (optional marketing line)
- Unique index `(tenant_id, public_booking_slug)`

**Verify after run**:
```sql
SELECT COUNT(*) FROM locations WHERE public_booking_slug IS NOT NULL;
-- Should equal count of locations that had a tour slug before

SELECT slug FROM tenants LIMIT 5;
-- Confirm tenant slugs exist — these become the URL segments
```

---

## 📦 Files (9 new)

### New files
```
src/lib/booking/availability.ts
src/app/api/public/book/[tenantSlug]/route.ts
src/app/api/public/book/[tenantSlug]/locations/[locationSlug]/route.ts
src/app/api/public/book/[tenantSlug]/locations/[locationSlug]/availability/route.ts
src/app/api/public/book/[tenantSlug]/locations/[locationSlug]/reserve/route.ts
src/app/book/layout.tsx
src/app/book/not-found.tsx
src/app/book/[tenantSlug]/page.tsx
src/app/book/[tenantSlug]/[locationSlug]/page.tsx
src/components/booking/BookingHeader.tsx
src/components/booking/BookingFooter.tsx
src/components/booking/BookingFlow.tsx
src/components/booking/PhotoGallery.tsx
docs/PHASE_6_DEPLOYMENT.md
```

### Already modified for Phase 5d (no extra changes for 6)
```
src/middleware.ts                                                            (exempts /book/* — done in 5d)
```

### npm packages
**None.**

---

## 🚀 Deploy

If Phase 5d already deployed, Phase 6 is **just `git pull` + rebuild**:

```powershell
cd C:\ZASHX-APPs\tap-app
git pull
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
pm2 restart itap-app
```

If 5d not yet deployed:
1. Run the SQL migration (see `PHASE_5D_DEPLOYMENT.md`)
2. Set the new env vars (META_CREDENTIAL_ENC_KEY, CRON_SECRET)
3. Then deploy as above.

---

## ⚙️ Optional env var

Set this if your booking pages run on a different domain than the API:

```env
# .env.production
NEXT_PUBLIC_APP_URL=https://itap.zashx.com
```

Defaults to `https://itap.zashx.com` in prod / `http://localhost:3000` in dev.

---

## 🧪 Test plan (15 min)

### Test 1 — Tenant lookup API (1 min)
```powershell
# Replace <tenant-slug> with one from your DB
curl.exe https://itap.zashx.com/api/public/book/<tenant-slug>
# Expected: 200 JSON with tenant + locations array

# Bad slug:
curl.exe https://itap.zashx.com/api/public/book/nonsense
# Expected: 404 { success: false, error: "Not found" }
```

### Test 2 — Landing page renders (1 min)
1. Open `https://itap.zashx.com/book/<your-tenant-slug>` in browser
2. ✅ **Expected**: clean landing with tenant name + grid of location cards
3. If only one location → ✅ redirects to `/book/<slug>/<location-slug>`

### Test 3 — Location detail (2 min)
1. Click into a location (or navigate directly)
2. ✅ Photo gallery shows real photos from MediaItem table
3. ✅ Click hero image → lightbox opens, arrow keys navigate
4. ✅ "Take a 360° tour" chip appears if location has PANORAMA_360 media
5. ✅ Right-side booking form is visible

### Test 4 — Availability API (3 min)
```powershell
# Replace slugs + date with real values
curl.exe "https://itap.zashx.com/api/public/book/<tenant>/locations/<loc>/availability?date=2026-05-25&partySize=2"
# Expected: { success: true, slots: [...] }
#   Each slot = { startsAt, label, remaining }
#   Slots before now+leadMinutes are filtered out

# Closed date (set blockReservations=true via admin Special Dates UI):
curl.exe "https://itap.zashx.com/api/public/book/<tenant>/locations/<loc>/availability?date=<closed-date>&partySize=2"
# Expected: { success: true, slots: [] }
```

### Test 5 — Complete a booking end-to-end (4 min)
1. On detail page, pick party size 2, today's date
2. Pick a time slot (any future slot)
3. Fill name + your real phone
4. Click "Confirm booking for 2 at …"
5. ✅ **Expected**:
   - Green check + "You're booked!" screen
   - Confirmation code (8 chars uppercase)
   - WhatsApp/SMS arrives within 5–10s
6. Check admin: `/dashboard/admin/reservations` should show your new reservation with `source = WEBSITE`

### Test 6 — Race condition handling (2 min)
1. Open the booking form, pick a slot but DON'T submit
2. In another tab, book the same slot to capacity (or have admin block it)
3. Submit the original form
4. ✅ **Expected**: red error banner "That time was just booked by someone else. Please pick another slot." + slot picker resets

### Test 7 — Rate limit (1 min)
```powershell
# Submit 6 reservations in a row from the same IP
1..6 | ForEach-Object {
  curl.exe -X POST `
    -H "Content-Type: application/json" `
    -d "{\"customerName\":\"Test $_\",\"customerPhone\":\"+14165550000\",\"partySize\":2,\"bookedFor\":\"2026-05-30T19:00:00.000Z\"}" `
    https://itap.zashx.com/api/public/book/<tenant>/locations/<loc>/reserve
}
# Expected: 6th returns HTTP 429 "Too many requests. Please try again in an hour."
```

### Test 8 — Closed location / disabled booking (1 min)
1. In Prisma Studio (or SQL), set `tenants.public_booking_enabled = false` for your test tenant
2. Visit `/book/<slug>` → ✅ should 404 (styled not-found page)
3. Reset: `UPDATE tenants SET public_booking_enabled = TRUE WHERE slug = '<slug>'`

---

## 🐛 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `/book/<slug>` 404s for a real tenant | Tenant has no bookable locations OR `public_booking_enabled = false` | Check `SELECT public_booking_enabled, public_booking_slug FROM locations WHERE tenant_id = '...'` |
| Slot picker stays empty all day | Location has no active+bookable tables, OR all special_dates block it | Verify `SELECT capacity, is_active, is_bookable FROM tables WHERE location_id = '...'` |
| Availability shows wrong hours | `operating_hours` JSON missing → falls back to default 11–22 | Set via DB or future admin UI. Shape: `{"mon":{"open":"11:00","close":"22:00"}, …}` |
| Confirmation message not sent | Phone format issue / no Meta or Twilio creds | Check pm2 logs for `[SMS DEV]` or `[WHATSAPP DEV]` lines — those mean fallback fired |
| `next/image` errors in console | We use `<img>` intentionally for tenant-uploaded photos (S3 URLs vary) | Working as designed — `eslint-disable next-line` comments are in place |
| Honey-pot incorrectly triggered | Browser autofill filled the hidden field | Field is `aria-hidden`, `tabIndex=-1`, in a `display: none` container. Modern browsers respect this. |
| Booking succeeds but admin reservations list is empty | RLS / tenantId mismatch | Check `SELECT location_id FROM reservations ORDER BY created_at DESC LIMIT 1` — confirm it matches your test location |

---

## 🏗️ Architecture decisions

| Decision | Why |
|---|---|
| `/book/[slug]` is its own top-level route, not under `/dashboard` | Public-facing; needs zero auth, separate SEO + analytics surface, clean URLs for sharing |
| Slug-based URL (not UUID) | `restaurant.com/book/la-bella-roma` is shareable and brandable; UUID would be ugly + leaks IDs |
| Server-rendered landing + detail, client-side flow | SEO benefit from initial paint; interactive form needs React for live slot updates |
| Auto-redirect for single-location tenants | One less click for the 80% case of single-location restaurants |
| Edge-cached metadata (60s), short-cached availability (30s) | Tenant info is stable; availability changes second-by-second. Cache misses are cheap. |
| Re-check slot availability on submit | Two guests could both have the form open. Submit-time recheck prevents double-booking the last seat. |
| Honey-pot anti-bot, not CAPTCHA | Bots fill all fields; humans skip hidden ones. Zero UX friction for real guests. |
| IP rate limit in-memory | Simple, resets safely on deploys. Per-IP cap of 5/hr is enough for legit "I changed my mind" reseatings. |
| Reservation source = WEBSITE | Distinguishes from PHONE / WALK_IN / INTERNAL in reservation reporting |
| Phone is required, email is optional | SMS / WhatsApp is the primary channel; some guests have no email but everyone has a phone |
| No payment / deposit on v1 booking page | Massive scope addition; deposits live in the data model already (Phase 1a `depositAmount`) so we can layer it on in Phase 6b without restructure |

---

## ⏭️ Coming next (Phase 6b candidates)

When 6 ships and gets real traffic, the obvious additions:
- **Deposits + card-on-file** at booking (uses existing `deposit_amount` + GP card token plumbing)
- **Operating hours admin UI** so businesses can set their own hours per day-of-week (currently a manual JSONB edit)
- **Custom domain support** — `book.restaurant.com` instead of `/book/restaurant-slug`
- **Email confirmation** + .ics calendar attachment
- **iframe embed snippet** — `<iframe src="https://itap.zashx.com/book/[slug]/[loc]?embed=1">` for restaurants to drop into their own website

Then **Phase 7 — Operator Console** (CSR portal, token health, audit log, billing).

---

## ✅ Sign-off

When you can:
1. Hit `/book/<your-tenant-slug>` and see the styled landing page ✓
2. Click into a location, see photos + 360 chip (if applicable) ✓
3. Complete a real booking → get WhatsApp/SMS confirmation ✓
4. Race condition test (Test 6) returns 409 properly ✓

→ Reply "Phase 6 green" and we're done with this batch. Next major: Phase 6b (deposits + hours UI) or Phase 7 (operator console) — your call.

If issues, paste:
```powershell
pm2 logs itap-app --nostream --lines 100 | Select-String "book|reserve|availability|public"
```
