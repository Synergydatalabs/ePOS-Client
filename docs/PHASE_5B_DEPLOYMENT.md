# Phase 5b Deployment — Waitlist + SMS + Special Dates

**Date**: 2026-05-18
**Scope**: Walk-in waitlist with SMS notifications, SMS confirmations for reservations, special dates admin UI (block-out / holiday hours).

**SMS uses Twilio if configured**, otherwise runs in "dev mode" (logs to server console — useful for testing without paying for SMS).

**Prerequisites**: Phase 1-5a all deployed.

---

## ✨ What ships

### Waitlist (`/dashboard/admin/waitlist`)
- 📋 **Live walk-in queue** — auto-refresh every 10s
- ➕ **Quick add walk-in** dialog (name + phone + party + section preference + notes)
- ⏱️ **Auto wait-time quotes** based on occupied tables + queue depth
- 📱 **Notify guest** button — sends SMS "table almost ready, reply 1 or 9"
- ✅ **Confirm** — after guest replies 1 (manual for now; Phase 5c auto-detects)
- 🪑 **Seat** — table picker → marks waitlist SEATED + table OCCUPIED
- 🚫 **No-show / Cancel / Remove** actions
- 📊 **Position number** in queue + wait time indicator (red when overdue)
- 🏷️ **Preferred section badge** with color coding

### Reservation SMS confirmations
- Auto-send confirmation SMS when reservation is created (if phone provided)
- Async (doesn't block reservation create)
- Updates `confirmation_sent_at` timestamp on success
- Failures logged but don't fail the reservation

### Special Dates (`/dashboard/admin/special-dates`)
- 📅 **List view** of upcoming closures + holiday hours
- ➕ **Create dialog**: date + label + what to block (reservations / walk-ins / online)
- 🕐 **Optional custom hours** override
- 💬 **Optional public message** shown to customers attempting to book on blocked dates
- 🚫 **Server-side enforcement** — reservation POST rejects bookings on blocked dates (Phase 5a)

### SMS service
- Twilio integration (real SMS) OR dev mode (console log)
- Pre-built templates for: reservation confirm, reminder, cancel, waitlist notify/confirm/remove
- Fire-and-forget — SMS failures never block primary actions
- Health check helper for UI status badges

### Sidebar
- Reservations item now has submenu: Reservations / Waitlist / Special dates

---

## 🗄️ Database changes — NONE

All needed tables (`waitlist_entries`, `special_dates`) were created in Phase 1a. This phase is pure code.

---

## 📦 Files to copy (12 new + 3 modified)

### New files
```
src/app/api/tenants/[tenantId]/locations/[locationId]/waitlist/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/waitlist/[entryId]/route.ts
src/app/api/tenants/[tenantId]/locations/[locationId]/waitlist/[entryId]/notify/route.ts

src/lib/sms/client.ts
src/lib/sms/templates.ts

src/components/waitlist/WaitlistQueue.tsx
src/components/waitlist/AddWalkinDialog.tsx
src/components/special-dates/SpecialDatesManager.tsx

src/app/dashboard/admin/waitlist/page.tsx
src/app/dashboard/admin/special-dates/page.tsx

docs/PHASE_5B_DEPLOYMENT.md
```

### Modified files
```
src/app/api/tenants/[tenantId]/locations/[locationId]/reservations/route.ts   (SMS hook on create)
src/components/admin/AdminSidebar.tsx                                          (Submenu)
.env.example                                                                   (SMS env vars)
```

### Folders to create on EC2
```powershell
mkdir "src\app\api\tenants\[tenantId]\locations\[locationId]\waitlist\[entryId]\notify"
mkdir src\lib\sms
mkdir src\components\waitlist
mkdir src\components\special-dates
mkdir src\app\dashboard\admin\waitlist
mkdir src\app\dashboard\admin\special-dates
```

### npm packages
**None new.** Twilio is called via fetch (no SDK dependency needed).

---

## 🚀 Deploy sequence

```powershell
cd C:\ZASHX-APPs\tap-app
git pull              # or copy files
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
pm2 restart itap-app
```

---

## ⚙️ Optional: enable real SMS (Twilio)

The app works fully without Twilio. SMS sends are logged to the server console instead. To send real SMS:

### 1. Sign up for Twilio
- https://twilio.com → trial credit gets you started
- Verify your account
- Buy an SMS-capable phone number ($1/mo + per-message fees)
  - Canada: ~$0.0075 per SMS
  - US: ~$0.0079 per SMS

### 2. Get credentials
- Console → Account → API keys & tokens
- Copy: Account SID + Auth Token

### 3. Add to `.env.production` on EC2
```env
SMS_ENABLED=true
SMS_DEV_FALLBACK=true
TWILIO_ACCOUNT_SID=AC...your-sid...
TWILIO_AUTH_TOKEN=...your-token...
TWILIO_FROM_NUMBER=+14165551234     # Your Twilio number, E.164 format
```

### 4. Restart
```powershell
pm2 restart itap-app
```

Now reservation confirmations + waitlist notifications go out as real SMS.

### Test without spending money
Twilio gives you a trial balance (~$15). Use it for testing. Send to your own phone first to verify formatting and delivery.

---

## 🧪 Test plan (12 min)

### Test 1 — Sidebar submenu (30 sec)
1. Sidebar → click "Reservations" to expand
2. ✅ **Expected**: Submenu shows 3 items: Reservations / Waitlist (walk-ins) / Special dates

### Test 2 — Open waitlist page (30 sec)
1. Click "Waitlist (walk-ins)"
2. ✅ **Expected**: Page loads. "No one is waiting" empty state. "Add walk-in" button visible.

### Test 3 — Add walk-in (2 min)
1. Click **"Add walk-in"** → dialog opens
2. Fill in:
   - Name: "Sarah Test"
   - Phone: your real cell number (so you can see the SMS)
   - Party size: click 4
   - Preferred area: pick a section if any exist
   - Notes: "Test entry"
3. Click **Add to queue**
4. ✅ **Expected**:
   - Toast: "Added Sarah Test — quoted Xm"
   - Entry appears in queue with position #1
   - Status badge "⏳ Waiting"
   - Wait time shown as "Waiting 0m"
   - Phone, party, section visible

### Test 4 — Notify (1 min)
1. Click **"Notify"** button on the entry
2. ✅ **Expected**:
   - Toast: "SMS sent to Sarah Test" (real) OR "Dev mode: SMS logged to server console" (dev)
   - Status changes to "📱 Notified"
   - Notify button replaced with "Confirm"

If Twilio is configured + your phone is in the entry, you should receive:
```
[Restaurant]: Sarah Test, your table for 4 is almost ready! Reply 1 to confirm you're still coming, or 9 to cancel. Thanks!
```

If in dev mode, check pm2 logs:
```powershell
pm2 logs itap-app --lines 20 | Select-String "SMS DEV"
```

### Test 5 — Confirm + Seat (2 min)
1. Click **"Confirm"** (simulating guest replied 1)
2. ✅ **Expected**: Status changes to "✅ Confirmed"
3. Click **"Seat"** button
4. ✅ **Expected**: Dialog opens with available tables
5. Pick a table → click "Seat at table"
6. ✅ **Expected**:
   - Toast: "Sarah Test → Seated"
   - Status changes to "🪑 Seated"
   - Table info shows "Seated at Table N"

### Test 6 — Verify table marked OCCUPIED (1 min)
1. Navigate to `/dashboard/pos/floor-view`
2. ✅ **Expected**: The table you seated is now showing OCCUPIED color (green / server color), with 4 guests

### Test 7 — Show completed (30 sec)
1. Back on waitlist page
2. Toggle **"Show completed today"**
3. ✅ **Expected**: Sarah Test entry visible (was hidden when only active shown)

### Test 8 — Reservation SMS confirmation (1 min)
1. Navigate to `/dashboard/admin/reservations`
2. Click "+ New reservation"
3. Pick time → party size → enter your name + your phone
4. Confirm
5. ✅ **Expected**: Reservation created. SMS sent (real if Twilio, console-logged if dev).

If real:
```
[Restaurant]: <Your name>, your reservation for <N> on <date/time> is confirmed. See you then!
```

DB verification:
```sql
SELECT customer_name, customer_phone, confirmation_sent_at
FROM reservations
WHERE confirmation_sent_at IS NOT NULL
ORDER BY created_at DESC
LIMIT 5;
```

### Test 9 — Special dates page (30 sec)
1. Sidebar → Reservations → Special dates
2. ✅ **Expected**: Page loads with "No special dates configured" empty state

### Test 10 — Create special date (2 min)
1. Click **"Add special date"**
2. Date: pick 7 days from now
3. Label: "Test closure"
4. Check "Block new reservations on this date"
5. Public message: "Closed for testing — try a different date"
6. Click **Save**
7. ✅ **Expected**: Entry appears in list with red "🚫 Reservations blocked" badge

### Test 11 — Verify block works (1 min)
1. Go to Reservations → + New reservation
2. Pick the same date you just blocked
3. Time + party + guest
4. Click Confirm
5. ✅ **Expected**: Error toast: "Reservations blocked for this date: Test closure"

### Test 12 — Delete special date (15 sec)
1. Back on Special dates page
2. Click trash icon → confirm
3. ✅ **Expected**: Entry removed. Re-test #11 — booking should now succeed.

---

## 🐛 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| SMS doesn't send (no toast change) | Twilio creds missing AND SMS_DEV_FALLBACK=false | Set creds, OR set fallback=true |
| SMS dev log doesn't appear | App not picking up env | Restart pm2 + hard refresh |
| "Cannot notify guest from status NOTIFIED" | Entry already notified | Use "Confirm" instead |
| Waitlist quote shows "0m" | No occupied tables yet | Quote uses turn time — works better once service is busy |
| Special date doesn't block | Wrong date format | Date stored as midnight UTC; check timezone match |
| Sarah's entry shows huge wait time | Quote inflated by other queue entries | Override `quotedWaitMinutes` manually in PATCH |

### Twilio-specific issues

| Symptom | Cause |
|---|---|
| Twilio 21211 — invalid 'To' phone | Phone not E.164. Fix: include country code (+1...) |
| Twilio 21610 — message blocked | Recipient opted out. Twilio enforces STOP/HELP. |
| Twilio 21408 — permission denied | Trial account, recipient not verified. Add to Verified Caller IDs. |
| Twilio 20003 — auth error | Wrong Account SID or Auth Token. Regenerate token. |

---

## 📋 SMS templates included

In `src/lib/sms/templates.ts` — edit to match your tone:

| Template | When sent |
|---|---|
| `reservationConfirmationMessage` | When new reservation created (Phase 5b) |
| `reservationReminderMessage` | 2-3 hours before reservation (Phase 5c will schedule) |
| `reservationCancelledMessage` | On cancel (Phase 5c will hook) |
| `waitlistNotifyMessage` | Click "Notify" on waitlist entry |
| `waitlistConfirmedMessage` | (Phase 5c — auto on inbound "1" reply) |
| `waitlistRemovedMessage` | (Phase 5c — auto on inbound "9" reply or timeout) |

---

## 🏗️ Architecture notes

- **SMS service is provider-abstracted** — easy to swap Twilio for SNS/MessageBird/etc. later
- **Fire-and-forget pattern** — primary actions (reservation create, waitlist notify) don't fail if SMS does
- **Dev mode lets you build without paying** — perfect for prelaunch testing
- **Wait time algorithm is "manual multiplier"** — simple heuristic. Phase 5c may add "Smart Algorithm" (Toast-style) using historical seating data.
- **No inbound SMS yet** — guests can't actually reply 1/9 to drive status. Phase 5c adds the Twilio webhook for that.

---

## ⏭️ Coming in Phase 5c

When you confirm Phase 5b works:
- **Twilio webhook** for inbound SMS (auto-confirm waitlist on "1", auto-remove on "9")
- **WhatsApp Business** integration (richer than SMS — buttons, lists, media)
- **Smart wait-time algorithm** with historical data
- **Scheduled reminders** (cron job sends reminder SMS 2 hours before reservation)
- **Cancellation SMS** + cancellation fee charge automation

After 5c, **Phase 6** is the white-label customer-facing booking page.

---

## ✅ Sign-off

When Tests 1-12 pass → reply "Phase 5b green" and I'll start Phase 5c (inbound SMS + WhatsApp).

If issues → paste:
1. Test number
2. Error/screenshot
3. pm2 logs filtered: `pm2 logs itap-app --nostream --lines 100 | Select-String "SMS|waitlist|special-date"`
