# Phase 7 Deployment — Partner Branding Consistency + New Landing Page

**Date**: 2026-05-18
**Scope**:
- Bare-domain branding lookup fix (oreugo.ca now resolves same as www.oreugo.ca)
- Partner-aware root layout metadata (correct `<title>` from first paint)
- Removal of hardcoded "Oreugo" / "iTAP" / "ZashX" strings in dashboard chrome
- Brand-color injection into admin sidebar + header + avatar tile
- Dynamic merchant name for Apple Pay / Google Pay sheets
- Hostname-aware logout (always returns to the same origin)
- New partner landing page based on `dsign-tailwind-nextjs-free` template (light theme, Poppins, partner logos + hero image)
- Poppins typography + leaf-button CSS utility shipped to globals
- Admin chrome opts into partner brand colors via CSS vars

**Prerequisites**: Phase 1-6 deployed. **No DB changes**, **no new env vars**.

---

## ✨ What ships

### Bug fixes (silent but important)

**1. Bare domain branding** (`src/lib/tenant-resolver.ts`)
- Previously: `SELECT * FROM tenant_settings WHERE custom_domain = 'oreugo.ca'` failed if the row stored `www.oreugo.ca`
- Now: lookup tries `host`, `host without www.`, AND `www.host` — whichever the partner stored is found
- Storage untouched (no data migration)

**2. Root layout title** (`src/app/layout.tsx`)
- Switched from `export const metadata` (static, build-time) to `async generateMetadata()` (per-request)
- Reads the host header on the server, resolves tenant, returns `"<BrandName> | Business Portal"` instead of `"iTAP | Point of Sale by ZASHX"`
- Falls back gracefully to iTap branding on `itap.zashx.com` / unknown hosts
- Also swaps the favicon to `brandFaviconUrl` when set

**3. Hardcoded "Oreugo" fallbacks gone** (`src/app/dashboard/layout.tsx`)
- Two `<span>Oreugo</span>` fallback strings replaced with `activeTenant?.name || "Dashboard"`
- So another partner's portal never shows literal "Oreugo" as a default

**4. Admin sidebar + header brand-aware** (`src/components/admin/AdminSidebar.tsx`, `AdminHeader.tsx`)
- Sidebar logo tile: shows uploaded `brandLogoUrl` if present, else a gradient using `--brand-primary` / `--brand-accent` CSS vars (set by the admin layout)
- Header avatar tile: background = `var(--brand-primary, #14b8a6)` — partners see their color, iTap users see the default teal
- Removed hardcoded "iTAP" fallback in sidebar title; now uses tenant name

**5. Admin layout injects brand context** (`src/app/dashboard/admin/layout.tsx`)
- Wraps in `<div style={cssVars} className="font-poppins">`
- `cssVars` from `usePartnerBranding()` exposes `--brand-primary`, `--brand-accent`, `--brand-bg`
- Adds `font-poppins` (Poppins typography from root layout's CSS var) only on admin surfaces — Inter remains default elsewhere
- Passes tenant logo URL down to AdminSidebar

**6. Dynamic merchant name** (`WalletButtons.tsx`, `DropInCheckout.tsx`)
- New `merchantName?: string` prop on both components
- Hardcoded `"Oreugo"` replaced with `merchantName || "ZashX"` (safer default than another partner's name)
- Callers (POS, public pay pages) should pass `activeTenant.name` or the partner brandName

**7. Hostname-aware logout** (`src/app/dashboard/layout.tsx`, `src/components/admin/AdminSidebar.tsx`)
- Was: `window.location.href = "/"` (works on partner domains but `"/partner/login"` hardcoded fallback could route to iTap)
- Now: `${window.location.origin}/...` for ALL redirects + branch on `host.endsWith("zashx.com")` to pick the right login path
- For Cognito staff: `signOut({ callbackUrl: \`${origin}/signin\` })` — never crosses to iTap accidentally

### New partner landing page (`src/app/partner/page.tsx`)

**Design language**: light theme borrowed from `dsign-tailwind-nextjs-free-main`:
- Poppins typography (already wired via root layout `--font-poppins` CSS var)
- Template's palette as defaults: `#0075FF` blue primary, `#002834` navy text, `#DAEBFF` light-blue section accent — **but** any partner-set `brandPrimaryColor` / `brandAccentColor` overrides
- Signature "leaf-button" curved CTA shape (`border-radius: 0 30px 30px 40px`) shipped as `.leaf-button` utility in globals.css

**Sections** (top to bottom):
1. **Nav** — sticky, white background, same menu items as before: Features / Solutions / Hardware / Pricing / Contact + Login + Get Started
2. **Hero** — split layout, left = headline + CTAs + trust badges, right = partner's `b9x79.jpg` hero image with floating "Orders today: 342" pill
3. **Stats strip** — 4 KPIs (Restaurants / Uptime / Support / Setup)
4. **Features grid** — 8 cards, brand-colored icon tiles
5. **Solutions / Why us** — alternating image+copy with checkmark bullets
6. **Contact** — same form fields as before (interests, name, email, phone, company, message)
7. **Footer** — 4 columns, dark navy background, partner white-wordmark logo, all the same links (About / Privacy / Terms / Cookies)
8. **Cookie banner** — light theme version

**Logos used** (already in `public/images/logo/pl/`):
- `oreugo_wordmark_black.png` → nav (dark on light background)
- `oreugo_wordmark_white.png` → footer (light on dark background)
- If partner uploads their own `brandLogoUrl` via Settings, it overrides both

**Hero image**: `public/images/home/b9x79.jpg` (already on EC2 at `C:\ZASHX-APPs\tap-app\public\images\home\`)

---

## 🗄️ Database changes — NONE

Pure code drop.

---

## ⚙️ Env vars — NONE

No new env vars. Pure code drop.

---

## 📦 Files (1 new + 8 modified + 1 doc)

### New
```
docs/PHASE_7_DEPLOYMENT.md                              ← this file
```

### Modified — branding consistency fixes
```
src/lib/tenant-resolver.ts                              ← bare-domain lookup match
src/app/layout.tsx                                       ← dynamic generateMetadata + Poppins font var
src/app/dashboard/layout.tsx                            ← hardcoded "Oreugo" gone + hostname-aware logout
src/app/dashboard/admin/layout.tsx                      ← partner branding injection (CSS vars + Poppins)
src/components/admin/AdminSidebar.tsx                   ← tenantLogoUrl prop, brand-color logo tile, hostname-aware sign-out
src/components/admin/AdminHeader.tsx                    ← brand-color avatar tile
src/components/pay/WalletButtons.tsx                    ← dynamic merchantName prop
src/components/pay/DropInCheckout.tsx                   ← dynamic merchantName prop
src/app/globals.css                                     ← .font-poppins + .leaf-button utilities
```

### Modified — new landing page
```
src/app/partner/page.tsx                                ← complete redesign with template aesthetic
```

### npm packages
**None added.** Poppins was added via existing `next/font/google` plumbing — no new dep.

---

## 🚀 Deploy

```powershell
cd C:\ZASHX-APPs\tap-app
git pull                                                # or copy 10 files
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
pm2 restart itap-app
```

Then a one-time hard refresh in the browser to bust the partner branding cache (in-memory; lives 5 min server-side, plus a per-tab cache in `usePartnerBranding`).

---

## 🧪 Test plan (~15 min)

### Test 1 — Bare-domain branding (2 min)
**The whole point of this phase.**

```powershell
# Verify bare apex returns partner branding (not iTap)
curl.exe -H "Host: oreugo.ca" https://itap.zashx.com/api/partner/branding
# Expected: { "success": true, "branding": { "tenantName": "Oreugo ...", "brandName": "Oreugo", ... } }

# www form should still work (regression check)
curl.exe -H "Host: www.oreugo.ca" https://itap.zashx.com/api/partner/branding
# Expected: SAME branding response
```

Then in browser:
1. Open `https://oreugo.ca/` — should show partner branding (logo, colors)
2. Open `https://www.oreugo.ca/` — should show identical branding

✅ **Both must look identical.** If `oreugo.ca` still shows iTap, check:
- DB row: `SELECT custom_domain FROM tenant_settings WHERE tenant_id = '<oreugo-id>'`
- Make sure it's `oreugo.ca` OR `www.oreugo.ca` (either one — the fix matches both)

### Test 2 — Root layout title (1 min)
1. Open `https://oreugo.ca/` — view page source (Ctrl+U), search `<title>`
2. ✅ Should read `Oreugo | Business Portal` (or whatever brandName is set)
3. Open `https://itap.zashx.com/` — `<title>` should still read `iTAP | Point of Sale by ZASHX`

### Test 3 — Dashboard chrome partner-aware (3 min)
1. Log in as a partner on `oreugo.ca/login`
2. After login on `/dashboard`:
   - ✅ Sidebar shows partner logo (or partner name) — **NEVER "Oreugo" literal as fallback** if you're testing another partner
   - ✅ Header avatar tile is partner brand color
   - ✅ Page title (`document.title`) reads `<brandName> | Admin Portal`
3. Navigate into `/dashboard/admin/integrations` (or any admin page)
   - ✅ Sidebar logo tile shows partner brand
   - ✅ Buttons and accents use partner primary color (look for the `tap-gradient` background — should be partner colors via CSS var)

### Test 4 — Hostname-aware logout (2 min)
1. Log in as partner on `oreugo.ca`
2. Go to `/dashboard/admin` (any admin page)
3. Click sidebar Sign Out
4. ✅ **Must land on `oreugo.ca/login`**, NOT `itap.zashx.com/anything`
5. Repeat with `www.oreugo.ca` — must land on `www.oreugo.ca/login`
6. For staff (Cognito) on `oreugo.ca`: same test, but lands on `oreugo.ca/signin` (the standard sign-in flow)

### Test 5 — New landing page design (3 min)
1. Open `https://oreugo.ca/` (incognito to avoid cached login)
2. ✅ Light theme (white background, blue accents)
3. ✅ Hero section shows `b9x79.jpg` on the right side
4. ✅ Nav logo = partner's black wordmark
5. ✅ "Get Started" button has curved leaf-button shape
6. ✅ Stats strip → Features grid → Solutions → Contact form → Dark footer
7. Cookie banner appears bottom (light theme version)
8. Mobile responsive — collapse menu, hero stacks

### Test 6 — Wallet merchant name (3 min)
**Needs Apple/Google Pay configured on the location — skip if not in scope yet.**

1. Open a public pay page (e.g., `/pay/<orderId>`)
2. Trigger Google Pay or Apple Pay sheet
3. ✅ Wallet shows the merchant name passed by the page (currently still defaults to "ZashX" until callers update to pass `merchantName` — see "Followups" below)

### Test 7 — Regression: iTap unchanged (1 min)
1. `https://itap.zashx.com/` — should look exactly as before (Inter font, indigo accents, "iTAP" branding)
2. Admin sidebar gradient still indigo
3. Avatar tile teal

---

## 🐛 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `oreugo.ca` still shows iTap after deploy | Stale in-memory cache (5 min TTL) | Wait 5 min OR restart pm2 |
| Bare domain still shows iTap after cache clear | `customDomain` column has neither `oreugo.ca` nor `www.oreugo.ca` | `UPDATE tenant_settings SET custom_domain = 'oreugo.ca' WHERE tenant_id = '<id>'` |
| Hero image broken (404) | `b9x79.jpg` not at `/images/home/b9x79.jpg` | Verify file exists on EC2: `ls C:\ZASHX-APPs\tap-app\public\images\home\` |
| Logo wordmark broken | `oreugo_wordmark_black.png` not in `/images/logo/pl/` | Verify: `ls C:\ZASHX-APPs\tap-app\public\images\logo\pl\` |
| Logout still goes to iTap | Browser cached old JS bundle | Hard refresh (Ctrl+Shift+R) after deploy |
| Admin sidebar still indigo (not partner color) | `usePartnerBranding` returned defaults (host didn't match) | Check the branding API directly: `curl -H "Host: oreugo.ca" .../api/partner/branding` |
| Page font still Inter on admin | Browser cached CSS | Hard refresh; verify `font-poppins` class on `<div>` in DevTools |
| Wallet shows "ZashX" instead of partner name | Caller pages haven't been updated to pass `merchantName` prop yet | See Followups |

---

## 🔮 Followups (NOT in this phase — for later)

These were intentionally **not** done now to keep the change focused:

1. **Update pay/order page callers** to pass `merchantName` to `<WalletButtons>` and `<DropInCheckout>`:
   - `src/app/table/[qrCode]/pay/[orderId]/page.tsx:569`
   - `src/app/pay/[orderId]/page.tsx:248`
   - Right now they don't pass it → wallet shows "ZashX" fallback. Easy 4-line change in each.

2. **Replace `<BookingFooter>` hardcoded "ZashX"** — only relevant once Phase 6 booking page is exposed publicly. Falls in the "we can hide this whole route for now" bucket from earlier.

3. **Apply Poppins to dashboard root layout** (currently only the admin sub-layout). Low priority since dashboard root is mostly admin shells anyway.

4. **Embedded Signup for Meta WhatsApp** — separate phase entirely (Phase 5e), needs Meta Tech Provider approval.

---

## 🏗️ Architecture decisions

| Decision | Why |
|---|---|
| Lookup normalization in `resolveTenant`, not storage migration | Whatever partners typed in is preserved. Lookup handles all three forms (host, www-stripped, www-prefixed) without touching data. |
| `generateMetadata` instead of client-side title swap | The HTML `<title>` is correct from the very first byte — no flash of "iTAP" before JS swaps it. Better SEO + perceived speed. |
| CSS vars (`--brand-primary`) for admin theming instead of dynamic class names | One injection point at the admin layout level; every descendant component reads `var(--brand-primary, #4f46e5)` and gets brand color free. Falls back to indigo for non-partner contexts. |
| Template colors as fallbacks, not overrides | Partners who DO set their brand colors keep them. Partners on a fresh setup get a polished default instead of generic indigo. |
| `.font-poppins` scoped utility instead of changing body default | Doesn't disturb the rest of the app. Easy to opt-in per surface. Inter remains the iTap default. |
| Hostname check uses `host.endsWith("zashx.com")` instead of an explicit partner list | New partners get hostname-aware logout for free without code changes when they're added. Single negative test instead of N positive matches. |
| Hero image hardcoded to `/images/home/b9x79.jpg` | Partner-specific; if they swap to another image, change one constant at top of `partner/page.tsx`. Future: make this a TenantSettings field. |

---

## ✅ Sign-off

When you can:
1. `oreugo.ca` AND `www.oreugo.ca` both show partner branding (Test 1) ✓
2. `<title>` reads partner brand on partner domain (Test 2) ✓
3. Admin sidebar + header pick up partner colors (Test 3) ✓
4. Logout lands on partner domain, never iTap (Test 4) ✓
5. New landing page renders with hero image + light theme (Test 5) ✓

→ Reply **"Phase 7 green"** and we plan what's next (likely the Operator Console — your Phase 7 originally — or wallet caller updates).

If issues, paste:
```powershell
pm2 logs itap-app --nostream --lines 100 | Select-String "partner|tenant-resolver|branding"
```
