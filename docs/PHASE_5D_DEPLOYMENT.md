# Phase 5d Deployment — Per-Tenant Meta Credentials + Scheduled Reminders

**Date**: 2026-05-18
**Scope**:
- Per-tenant BYO Meta WhatsApp credentials (manual paste form, encrypted at rest)
- Scheduled reservation reminders (24-hour + 2-hour windows)
- Inbound webhook tenant routing by `phone_number_id`
- Conversation message inbox schema (UI in future phase)

**Prerequisites**: Phase 1-5c deployed (especially 5c WhatsApp webhook + middleware exemption).

---

## ✨ What ships

### 1. Per-tenant Meta credentials (admin UI + API)
- **Page**: `/dashboard/admin/integrations` (hub) + `/dashboard/admin/integrations/whatsapp` (form)
- Business pastes 5 values from Meta (phone_number_id, waba_id, access_token, app_secret, verify_token)
- Secrets encrypted with **AES-256-GCM** before storage, decrypted only when needed
- "Send test message" button proves end-to-end before staff rely on it
- Disconnect button clears credentials → falls back to shared ZashX sender
- Status pill on the integrations hub shows: `Connected` (green) / `Using shared sender` (amber) / `Not connected` (gray)

### 2. Credential resolution (sender side)
- New module: `src/lib/whatsapp/credentials.ts`
- `resolveMetaCredentialsForTenant(tenantId)` returns first usable from:
  1. Tenant's own stored creds (`source: "tenant"`)
  2. Shared platform env creds (`source: "shared"`)
  3. `null` → falls back to dev mode (console log)
- `sendWhatsApp(...)` now stamps `credentialSource` on every result for billing/debugging traces

### 3. Inbound webhook tenant routing
- `/api/webhooks/whatsapp` POST now reads `value.metadata.phone_number_id` BEFORE touching any data
- Reverse-lookup `findTenantByPhoneNumberId()` → scoped queries (waitlist matching only against that tenant's locations)
- Falls back to global scan if no tenant matches (shared-sender traffic)
- Signature verification tries shared app secret first, then per-tenant
- GET handshake supports both shared `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` AND per-tenant verify tokens

### 4. Conversation message inbox (schema only)
- New table `conversation_messages` captures every inbound message that doesn't match a waitlist 1/9
- Indexed on `(tenant_id, created_at DESC)` for the future admin inbox
- Webhook now writes to it automatically for non-1/9 inbound

### 5. Scheduled reservation reminders
- **Cron endpoint**: `POST /api/cron/reservation-reminders` (also accepts GET for schedulers that don't do POST)
- **Service**: `src/lib/reminders/service.ts` — `runReservationReminders("24h" | "2h")`
- Auth via `CRON_SECRET` Bearer header (no secret = dev mode allows all)
- Picks **WhatsApp if tenant or platform has creds**, else **SMS**
- Idempotent — uses `reservations.reminder_24h_sent_at` + `reminder_2h_sent_at` columns
- 50-reservation cap per tick so it can't blow up
- Windows: 24h window covers reservations 23.5–25h out; 2h window covers 1.5–2.75h out (forgiving against missed ticks)

---

## 🗄️ Database changes

**Run this SQL on the EC2 PostgreSQL via your bastion**:

```bash
# From bastion EC2:
psql $DATABASE_URL -f /path/to/2026-05-18_phase5d_phase6_meta_creds_and_booking.sql
```

This single migration covers Phase 5d AND Phase 6 (so you only run it once).

### What it changes
- `tenants` — adds 10 `meta_*` columns + `public_booking_enabled` + `booking_tagline` + index on `meta_phone_number_id`
- `locations` — adds `public_booking_enabled`, `public_booking_slug`, `operating_hours` (JSONB), `booking_lead_minutes`, `booking_slot_minutes`, `booking_max_party_size`, `booking_hero_media_id` + unique index `(tenant_id, public_booking_slug)`
- `reservations` — adds `reminder_24h_sent_at` + `reminder_2h_sent_at` + index on `(booked_for, status)`
- New table `conversation_messages` (for the future inbox)

### Idempotency
All `ALTER TABLE` use `IF NOT EXISTS`. All `CREATE INDEX` use `IF NOT EXISTS`. Re-running the script is safe.

### Verify after run
```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'tenants' AND column_name LIKE 'meta%';
-- Should list 10 rows

SELECT column_name FROM information_schema.columns
 WHERE table_name = 'reservations' AND column_name LIKE 'reminder%';
-- Should list 3 rows (reminder_sent_at + reminder_24h_sent_at + reminder_2h_sent_at)

SELECT COUNT(*) AS backfilled_booking_slugs FROM locations WHERE public_booking_slug IS NOT NULL;
-- Should equal count of locations with public_tour_slug already set
```

### After SQL, run on dev box
```powershell
cd C:\Mod App\tap-app
npx prisma db pull       # confirm schema matches
npx prisma generate      # regenerate Prisma Client types
```

---

## 📦 Files (10 new + 5 modified)

### New
```
prisma/migrations/manual/2026-05-18_phase5d_phase6_meta_creds_and_booking.sql
src/lib/crypto/encryption.ts                                             — AES-256-GCM
src/lib/whatsapp/credentials.ts                                          — per-tenant lookup
src/lib/reminders/service.ts                                             — reminder dispatcher
src/app/api/tenants/[tenantId]/integrations/whatsapp/route.ts            — config API
src/app/api/cron/reservation-reminders/route.ts                          — cron endpoint
src/app/dashboard/admin/integrations/page.tsx                            — integrations hub
src/app/dashboard/admin/integrations/whatsapp/page.tsx                   — WhatsApp paste form
docs/PHASE_5D_DEPLOYMENT.md                                              — this file
docs/PHASE_6_DEPLOYMENT.md                                               — Phase 6 (shipped together)
```

### Modified
```
prisma/schema.prisma                                                     — Tenant + Location + Reservation + ConversationMessage
src/lib/whatsapp/client.ts                                               — uses credentials.ts
src/lib/whatsapp/templates.ts                                            — adds reservationReminderText()
src/app/api/webhooks/whatsapp/route.ts                                   — tenant routing by phone_number_id
src/components/admin/AdminSidebar.tsx                                    — Integrations menu item
src/middleware.ts                                                        — exempts /api/cron + /book
```

### npm packages
**None.** Uses Node's built-in `crypto`.

---

## 🚀 Deploy

```powershell
cd C:\ZASHX-APPs\tap-app
git pull                              # or copy the 15 files

# Apply DB migration first (from bastion):
# psql $DATABASE_URL -f /path/to/migration.sql

# Regenerate Prisma Client locally too if you build on EC2:
npx prisma generate

Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
pm2 restart itap-app
```

---

## ⚙️ Required env vars

### Generate the encryption key (one-time, NEVER rotate without re-encrypt script)

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Copy the 44-char base64 string into .env.production
```

### Add to `.env.production`

```env
# Phase 5d: AES-256-GCM master key for tenant credential encryption
# DO NOT change once set — existing rows become unreadable.
META_CREDENTIAL_ENC_KEY=<base64-44-char-string-from-above>

# Phase 5d: Cron auth (any long random string)
CRON_SECRET=cron_secret_change_me_to_a_long_random_string
```

Restart pm2 after setting:
```powershell
pm2 restart itap-app
```

---

## ⏰ Configure the cron scheduler (Windows Task Scheduler)

Pick **every 15 minutes** — small enough that we never miss the 2-hour window, large enough to avoid hammering the DB.

```powershell
# Run as Administrator
schtasks /create `
  /tn "iTap Reservation Reminders" `
  /tr "powershell -NoProfile -Command \"Invoke-WebRequest -UseBasicParsing -Method POST -Uri https://itap.zashx.com/api/cron/reservation-reminders -Headers @{Authorization='Bearer YOUR_CRON_SECRET'} | Out-Null\"" `
  /sc minute `
  /mo 15 `
  /ru SYSTEM
```

Or, if you prefer GitHub Actions:
```yaml
# .github/workflows/reservation-reminders.yml
on:
  schedule:
    - cron: '*/15 * * * *'
jobs:
  ping:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://itap.zashx.com/api/cron/reservation-reminders
```

---

## 🧪 Test plan (~20 min)

### Test 1 — Encryption round-trip (1 min)
```powershell
cd C:\Mod App\tap-app
node -e "
  require('dotenv').config({ path: '.env.local' });
  const { encryptString, decryptString } = require('./src/lib/crypto/encryption');
  const token = encryptString('hello-meta-token');
  console.log('encrypted:', token);
  console.log('decrypted:', decryptString(token));
"
# Expected: prints versioned cipher string + 'hello-meta-token'
```

### Test 2 — Integrations hub (2 min)
1. Open `/dashboard/admin/integrations`
2. WhatsApp card should show:
   - "Using shared sender" (amber) if `META_WHATSAPP_*` env vars set
   - "Not connected" (gray) if env vars empty
3. Click → lands on `/dashboard/admin/integrations/whatsapp`

### Test 3 — Save manual credentials (3 min)
1. Paste any values into the form fields (use dummy data for now — Meta won't validate format on save):
   - Phone Number ID: `123456789012345`
   - WhatsApp Business Account ID: `987654321098765`
   - Display Name: `Test Restaurant`
   - Access Token: `EAAtest123access456token`
   - App Secret: `dummy_app_secret_12chars`
   - Webhook Verify Token: `my-random-verify-string`
2. Click **Save credentials**
3. ✅ **Expected**: green banner "Saved." + page reloads showing "Connected as Test Restaurant"
4. Verify DB:
   ```sql
   SELECT meta_phone_number_id, LEFT(meta_access_token_enc, 20) AS token_preview,
          meta_display_name, meta_connection_type, meta_connected_at
     FROM tenants WHERE id = '<your-tenant-id>';
   -- Expected: phone_number_id plaintext, token_preview starts with "v1." (encryption marker)
   ```

### Test 4 — Test send (dev mode) (1 min)
1. On the same page, enter your phone (any string for dev test) → click **Send test**
2. ✅ **Expected**: green banner "Test sent via dev/tenant. Check your WhatsApp — message id dev-…"
3. Check pm2 logs:
   ```powershell
   pm2 logs itap-app --lines 20 | Select-String "WHATSAPP DEV"
   # Expected: line with your tenant slug + phone + test message body
   ```

### Test 5 — Disconnect (1 min)
1. Click **Disconnect** → confirm dialog
2. ✅ **Expected**: blue banner "Disconnected." + page shows "Using shared sender" (or "Not connected")
3. Verify DB:
   ```sql
   SELECT meta_phone_number_id, meta_access_token_enc FROM tenants WHERE id = '<your-tenant-id>';
   -- Both should be NULL
   ```

### Test 6 — Inbound webhook tenant routing (5 min)
**Pre-setup**: temporarily save tenant creds again (Test 3 values), so the tenant has a `meta_phone_number_id`.

```powershell
# Simulate Meta sending an inbound message FOR that tenant's number
$body = @'
{
  "entry": [{
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "+14165551234", "phone_number_id": "123456789012345" },
        "messages": [{
          "from": "14165550000",
          "id": "wamid.test",
          "timestamp": "1700000000",
          "type": "text",
          "text": { "body": "1" }
        }]
      }
    }]
  }]
}
'@

# This will reject for signature in prod — TEMPORARILY clear META_WHATSAPP_APP_SECRET for the test, or use a tunnel + real signature.
curl.exe -X POST -H "Content-Type: application/json" -d $body https://itap.zashx.com/api/webhooks/whatsapp
```

✅ **Expected log line**: `[whatsapp inbound] tenant=<8-char-id> from=14165550000 text="1"`
   (with tenant id MATCHING your test tenant — not `shared`)

### Test 7 — Reservation reminders cron (dry run) (3 min)
```powershell
# Dry run — counts rows without sending
curl.exe -X POST `
  -H "Authorization: Bearer YOUR_CRON_SECRET" `
  "https://itap.zashx.com/api/cron/reservation-reminders?dryRun=1"
```

✅ **Expected**: JSON with `window24h.considered: N`, `window24h.sent: 0`, `window24h.skipped: 0` (sent=0 because dryRun).

### Test 8 — Real reminder send (5 min)
1. In admin UI, create a reservation booked for **~24 hours from now** (use a real phone you control).
2. Run cron live:
   ```powershell
   curl.exe -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" `
     https://itap.zashx.com/api/cron/reservation-reminders
   ```
3. ✅ **Expected**: receive WhatsApp (or SMS dev-log) "Reminder — your reservation for X is …"
4. Verify DB:
   ```sql
   SELECT id, customer_name, booked_for, reminder_24h_sent_at
     FROM reservations
    WHERE reminder_24h_sent_at IS NOT NULL
    ORDER BY reminder_24h_sent_at DESC LIMIT 3;
   ```
5. Run cron AGAIN immediately:
   - ✅ **Expected**: `sent: 0` for that reservation (idempotency — won't double-send)

### Test 9 — Cron auth rejection (1 min)
```powershell
# Without auth header
curl.exe -X POST https://itap.zashx.com/api/cron/reservation-reminders
# Expected: HTTP 401 { success: false, error: "Unauthorized" }
```

---

## 🐛 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `META_CREDENTIAL_ENC_KEY is not set` on boot | Env var missing in production | Generate + set per instructions above, restart pm2 |
| Saved credentials but test fails with "Meta 401" | Token expired or doesn't have `whatsapp_business_messaging` permission | Regenerate System User token in Meta with correct permissions |
| Test sends but real waitlist sends fail | tenant_id passed correctly? | Check pm2 logs for `[WhatsApp Meta] send failed (source=tenant)` — `source` tag confirms which cred set ran |
| Cron returns 401 in production | `CRON_SECRET` mismatch between env and scheduler | Re-copy the env value into your scheduler config |
| Cron returns `considered: N, sent: 0, failed: N` | Send provider failing for ALL reservations | Inspect `detail[].error` in JSON response |
| Same reservation gets a reminder twice | Two cron schedulers running, or DB column wasn't created | Check `SELECT reminder_24h_sent_at` after first run — should be non-null |
| Inbound webhook says `tenant=shared` for tenant-BYO traffic | Tenant's `meta_phone_number_id` doesn't match Meta's payload | Confirm the EXACT Phone Number ID from Meta API Setup is saved (not the phone number itself) |
| Webhook signature verification keeps failing | App secret saved wrong, or you set up the webhook in the wrong Meta app | Re-copy app secret from Meta Apps → Settings → Basic |

---

## 🏗️ Architecture decisions

| Decision | Why |
|---|---|
| Encrypt tokens with AES-256-GCM at rest | Standard for app-layer cred storage; rules out DB dump credential theft |
| `phone_number_id` stays plaintext | Not secret (Meta calls it a "routing handle"), needs to be indexed for fast inbound lookup |
| Single `META_CREDENTIAL_ENC_KEY`, versioned cipher format | Lets us rotate algo (`v1` → `v2`) in a future migration without breaking |
| Falls back to shared sender, not failure, when tenant has no creds | Zero-friction onboarding — tenant works immediately, can BYO later |
| Cron is HTTP endpoint, not in-app scheduler | Decouples from app process; killing pm2 doesn't break reminders. Easy to switch schedulers. |
| 15-min cron tick with 1.5h forgiving windows | Survives one missed tick (e.g., during deploy) without losing reminders |
| Inbound webhook routes by `phone_number_id` BEFORE downstream queries | Multi-tenant data isolation — tenant A's WhatsApp can never accidentally update tenant B's waitlist |
| Try shared HMAC first, then per-tenant | 99% of inbound is shared sender, optimizes for the common path |
| Mark `reminder_24h_sent_at` regardless of send success | If Twilio/Meta is down we still don't want to spam the guest with retries on the next cron tick |
| Manual paste form before Embedded Signup | Ships today, no Meta App Review delay. Embedded Signup adds a UI tab later. |

---

## ⏭️ Coming in Phase 5e / 6 / 7

When you confirm 5d works:
- **Phase 5e**: Embedded Signup popup (requires Meta Tech Provider status — ~2 weeks application)
- **Phase 6**: Public booking page at `/book/[tenant-slug]` (SHIPPED ALONGSIDE 5d — see PHASE_6_DEPLOYMENT.md)
- **Phase 7**: Operator console (CSR portal, audit log, token health monitor, billing dashboard)

---

## ✅ Sign-off

When you can:
1. Encryption round-trip works (Test 1) ✓
2. Save + disconnect credentials (Tests 3 + 5) ✓
3. Inbound webhook tags `tenant=<id>` not `shared` (Test 6) ✓
4. Cron sends a reminder + is idempotent (Test 8) ✓

→ Reply "Phase 5d green" and we move on. If issues, paste:
```powershell
pm2 logs itap-app --nostream --lines 100 | Select-String "encrypt|whatsapp|reminder|integration|cron"
```
