# Phase 5c Deployment — WhatsApp + Inbound Webhooks

**Date**: 2026-05-18
**Scope**:
- WhatsApp Business via Meta Cloud API (mirror of SMS service)
- Inbound WhatsApp webhook (auto-parse "1"/"9" waitlist replies)
- Inbound Twilio SMS webhook (same)
- Waitlist notify supports SMS / WhatsApp / both channels

**Architecture**: shared Meta account for all tenants in v1. Per-tenant BYO Meta accounts coming in Phase 5d (DB column + admin OAuth flow).

**Prerequisites**: Phase 1-5b deployed.

---

## ✨ What ships

### WhatsApp service (`src/lib/whatsapp/client.ts`)
- Mirror of SMS service architecture
- Real send via Meta Cloud API if creds set
- Dev mode (console log) fallback
- Supports both **free-form text** (24h window) and **template** (cold start) sends
- `tenantId` passed for future per-tenant credential lookup

### WhatsApp inbound webhook (`/api/webhooks/whatsapp`)
- GET = Meta verification handshake
- POST = guests' replies (e.g. "1" or "9" to waitlist messages)
- HMAC signature verification with `META_WHATSAPP_APP_SECRET`
- Auto-updates waitlist status on "1" (CONFIRMED) or "9" (CANCELLED)
- Sends acknowledgement back to guest

### Twilio SMS inbound webhook (`/api/webhooks/twilio-sms`)
- Same pattern — handles SMS replies
- X-Twilio-Signature verification
- Auto-updates waitlist status
- Returns empty TwiML (no auto-reply from Twilio)

### Channel routing on waitlist notify
```js
POST /api/.../waitlist/[id]/notify
Body: { channel: "SMS" | "WHATSAPP" | "BOTH" }   // default "SMS"
```

### Middleware exemption
`/api/webhooks/*` paths are now exempt from auth (request signing replaces it).

---

## 🗄️ Database changes — NONE

Uses existing `waitlist_entries.sms_reply_at` and `sms_reply_value` columns from Phase 1a. Pure code drop.

---

## 📦 Files (5 new + 3 modified)

### New
```
src/lib/whatsapp/client.ts
src/lib/whatsapp/templates.ts
src/app/api/webhooks/whatsapp/route.ts
src/app/api/webhooks/twilio-sms/route.ts
docs/PHASE_5C_DEPLOYMENT.md
```

### Modified
```
src/app/api/tenants/[tenantId]/locations/[locationId]/waitlist/[entryId]/notify/route.ts   (channel param)
src/middleware.ts                                                                            (webhook auth exemption)
.env.example                                                                                 (WhatsApp + Twilio webhook vars)
```

### Folders
```powershell
mkdir src\lib\whatsapp
mkdir src\app\api\webhooks\whatsapp
mkdir src\app\api\webhooks\twilio-sms
```

### npm packages
**None.**

---

## 🚀 Deploy

```powershell
cd C:\ZASHX-APPs\tap-app
git pull       # or copy 8 files
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
pm2 restart itap-app
```

Without Meta credentials, WhatsApp will run in dev mode (console log). Waitlist notify with `channel=WHATSAPP` will log to console instead of sending. Safe to deploy + test before setting up Meta.

---

## ⚙️ Optional — set up Meta WhatsApp Business

### One-time platform setup (you do this once for the whole SaaS)

1. **Go to https://business.facebook.com/**
2. Create Business Account (if not exists)
3. **Settings → Business Settings → WhatsApp Accounts → Add**
4. Add a phone number you control
   - Must NOT be already on WhatsApp app (or migrate from app)
   - Verify via SMS or call
   - This will be the "from" number for all tenants in v1
5. **Settings → Users → System Users → Add**
   - Role: Admin
   - Assign assets: your WhatsApp Business Account
6. **Generate token** for that System User
   - Token expiration: **Never** (for permanent backend use)
   - Permissions: `whatsapp_business_management`, `whatsapp_business_messaging`
   - **Copy the token immediately — you only see it once**
7. **WhatsApp Business → API Setup**
   - Note the **Phone Number ID** (different from the phone number itself)
   - Note the **WhatsApp Business Account ID**

### Webhook configuration

8. **Apps → your app → WhatsApp → Configuration**
9. Set **Callback URL**: `https://itap.zashx.com/api/webhooks/whatsapp`
10. Set **Verify Token**: any random string (you'll paste this in env vars)
11. **Verify and Save** — Meta calls your endpoint to confirm — should succeed if you've deployed Phase 5c
12. **Subscribe to webhook fields**: at minimum `messages`

### Get the app secret

13. **Apps → your app → Settings → Basic**
14. Click "Show" on **App Secret** → copy

### Add to `.env.production`

```env
WHATSAPP_ENABLED=true
WHATSAPP_DEV_FALLBACK=true

META_WHATSAPP_PHONE_NUMBER_ID=          # from API Setup
META_WHATSAPP_ACCESS_TOKEN=             # System User permanent token
META_WHATSAPP_BUSINESS_ACCOUNT_ID=      # from API Setup
META_WHATSAPP_WEBHOOK_VERIFY_TOKEN=     # the random string you made up
META_WHATSAPP_APP_SECRET=               # from App Settings → Basic
```

Restart:
```powershell
pm2 restart itap-app
```

---

## ⚙️ Optional — Twilio inbound SMS

1. Twilio Console → Phone Numbers → your number
2. **Messaging Configuration**
3. **A MESSAGE COMES IN** → set:
   - Webhook URL: `https://itap.zashx.com/api/webhooks/twilio-sms`
   - HTTP POST
4. Save

Twilio will now POST to your endpoint when a guest texts you. Auth token (already in env) is used to verify the signature.

---

## 🧪 Test plan (12 min, mostly without Meta setup)

### Test 1 — Webhook endpoints exist (1 min)

```powershell
# GET (Meta verification) — should return 403 without correct token
curl.exe "https://itap.zashx.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=test"
# Expected: HTTP 403 + "Forbidden"

# GET (Meta verification) with correct token after env var set
# Replace YOUR_TOKEN with what you set in META_WHATSAPP_WEBHOOK_VERIFY_TOKEN
curl.exe "https://itap.zashx.com/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=YOUR_TOKEN&hub.challenge=test"
# Expected: HTTP 200 + "test"

# POST (Twilio inbound) — without signature it should reject in prod
curl.exe -X POST -d "From=%2B14165551234&Body=1" https://itap.zashx.com/api/webhooks/twilio-sms
# Expected: HTTP 403 (signature missing) unless TWILIO_AUTH_TOKEN is empty
```

### Test 2 — Waitlist notify with WhatsApp (dev mode) (3 min)

1. Open `/dashboard/admin/waitlist`
2. Add a walk-in with your real phone number
3. Open DevTools → Network tab
4. Click **Notify** button
5. **Modify the request manually** (or use this curl):

```powershell
# Get cookie from browser DevTools → copy as cURL
curl.exe -X POST `
  -H "Content-Type: application/json" `
  -H "Cookie: <your-session>" `
  -d "{\"channel\":\"WHATSAPP\"}" `
  https://itap.zashx.com/api/tenants/<tenant-id>/locations/<loc-id>/waitlist/<entry-id>/notify
```

6. Check pm2 logs:
```powershell
pm2 logs itap-app --lines 20 | Select-String "WHATSAPP DEV"
```

✅ **Expected**: log line showing "→ <phone> [waitlist_notify] <message body>"

If Meta is configured: you'll receive an actual WhatsApp message.

### Test 3 — Inbound SMS simulating "1" reply (3 min)

Pretend you're Twilio:
```powershell
# Note: this WILL fail signature check if TWILIO_AUTH_TOKEN is set in prod.
# For testing, temporarily clear it or use ngrok to your localhost.

# First create a waitlist entry + notify so there's an entry in NOTIFIED status.

# Then simulate the inbound:
curl.exe -X POST `
  -H "Content-Type: application/x-www-form-urlencoded" `
  -d "From=%2B14165551234&Body=1&MessageSid=test123" `
  https://itap.zashx.com/api/webhooks/twilio-sms
# Expected: HTTP 200 + empty TwiML
```

Then check the waitlist:
- ✅ **Expected**: Entry status changes from NOTIFIED to CONFIRMED automatically
- ✅ Auto-reply sent (check pm2 logs for SMS DEV)

```sql
SELECT customer_phone, status, sms_reply_at, sms_reply_value
FROM waitlist_entries
ORDER BY created_at DESC LIMIT 5;
-- Should show sms_reply_value='1' and status='CONFIRMED'
```

### Test 4 — Inbound "9" cancels (1 min)

Same as above but body=9 → expect status=CANCELLED + cancellation acknowledgement.

### Test 5 — WhatsApp inbound (if Meta set up)

Send "1" from your phone to the WhatsApp Business number after being notified.
- ✅ Waitlist status → CONFIRMED
- ✅ You receive ack message back

### Test 6 — Reservation create still sends SMS (regression check)

Verify earlier Phase 5b SMS confirmation still works (didn't break anything).

---

## 🐛 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Meta webhook verification fails | Wrong VERIFY_TOKEN | Match exactly between Meta config and env |
| All inbound webhooks return 403 | Signature verification failing | Check APP_SECRET / AUTH_TOKEN match real values; for dev set them empty to bypass |
| WhatsApp message not received but log says success | Phone not subscribed to your business or template not approved | First message must be from guest TO you (24h window opens); OR send a pre-approved template |
| Twilio webhook signature fails | Twilio sends URL it called — must match exactly | Set TWILIO_WEBHOOK_URL env to override if behind proxy |
| Inbound "1" reply doesn't update waitlist | No matching NOTIFIED entry within last 30 min | Match window is intentional — older entries are stale |
| 500 on /webhooks/whatsapp POST | Body parsing error | Check JSON validity; pm2 logs for stack trace |

---

## 🏗️ Architecture decisions

| Decision | Why |
|---|---|
| Single shared Meta account in env | Zero-friction onboarding for v1. BYO comes in Phase 5d. |
| `tenantId` always passed to send functions | Future-proofs for per-tenant cred lookup without code changes elsewhere |
| Webhook routes auth-exempt + signature-verified | Standard pattern for third-party callbacks |
| Fire-and-forget processing in webhooks | Meta/Twilio retry on non-2xx → duplicate processing. Return 200 fast, process async |
| 30-min window for inbound reply matching | Avoids stale entries auto-confirming hours later when guest sends unrelated "1" |
| Free-form text vs template send | Free-form only works in 24h window. Template required for cold starts but needs pre-approval. v1 uses free-form (works for waitlist where guest is actively engaged). |

---

## ⏭️ Coming in Phase 5d

When you confirm 5c works:
- **Per-tenant BYO Meta credentials** via OAuth + DB storage (encrypted)
- **WhatsApp template approval UI** in admin
- **Scheduled reservation reminders** (cron sends 2-3 hrs before)
- **Auto cancellation fee charging** via GP card token

After 5d → **Phase 6** = white-label customer-facing booking page.

---

## ✅ Sign-off

When you can:
1. Webhook endpoints respond (Test 1) ✓
2. Waitlist notify with channel=WHATSAPP logs to console (dev mode) (Test 2) ✓
3. Inbound POST updates waitlist entry (Test 3) ✓

→ Reply "Phase 5c green" and I'll start Phase 5d (per-tenant credentials + customer booking page).

If issues → paste failing test + logs:
```powershell
pm2 logs itap-app --nostream --lines 100 | Select-String "whatsapp|twilio-sms|webhook|WHATSAPP|waitlist"
```
