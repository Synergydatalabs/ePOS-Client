# Dash Rides Toronto — Demo Guide
### iTAP Cab & Transport Module by ZashX

---

## Quick Overview

Dash Rides Toronto is a demo cab/transport business built on the iTAP platform. This guide walks you through the admin portal (dispatch, fleet management) and driver app to explore the full ride-hailing workflow.

---

## Login Credentials

### Owner / Admin Portal

| Field | Value |
|-------|-------|
| URL | **itap.zashx.com/partner/login** |
| Email | `demo@zashx.com` |
| Password | `Demo2026!` |
| Select Business | **Dash Rides Toronto** |

> After login, you'll see the cab-specific admin dashboard with trip stats, driver status, and quick actions.

### Driver App

| Driver | Email | Password | Vehicle |
|--------|-------|----------|---------|
| Ahmed Hassan | `driver1@demo.itap` | `Demo2026!` | Toyota Camry 2023 (White) |
| Raj Patel | `driver2@demo.itap` | `Demo2026!` | Honda CR-V 2022 (Black) |
| Maria Santos | `driver3@demo.itap` | `Demo2026!` | Dodge Caravan 2021 (Silver) |

| Field | Value |
|-------|-------|
| Driver Login URL | **itap.zashx.com/drive/driver/login** |

---

## What to Check in the Demo

### 1. Admin Dashboard
- **Today's Trips** — total ride count for the day
- **Today's Revenue** — total fare revenue
- **Online Drivers** — how many drivers are currently on duty
- **Active Trips** — trips currently in progress
- Quick action buttons: Dispatch, Trips, Drivers, Vehicles

### 2. Dispatch Board (Live)
- Real-time view of all active trips
- Status tabs: Searching, Assigned, In Progress
- Assign available drivers to pending rides
- Cancel trips with reason
- Auto-refreshes every 10 seconds

### 3. Driver Management
- View all registered drivers with status (Online / Offline / On Trip)
- See driver details: license, vehicle assignment, rating, total trips
- Add new drivers from existing staff members
- Edit driver profile (license, vehicle, commission rate)

### 4. Vehicle Fleet
- Full fleet inventory with plate, make, model, year, color
- See which driver is assigned to each vehicle
- Add / edit / remove vehicles

### 5. Zones
- Service area configuration (Downtown, Airport, Suburbs, etc.)
- Zone-based surcharges (e.g., Airport Fee — flat $5.00)
- Toggle zones active/inactive

### 6. Fare Rules
- Pricing by vehicle type (Sedan, SUV, Van, Luxury)
- Base fare, per-km rate, per-minute rate, booking fee
- Peak hours multiplier, night rate multiplier
- Waiting charges, cancellation fees
- Minimum fare thresholds

### 7. Promo Codes
- Create percentage or flat discount codes
- Set validity dates, usage limits, minimum fare requirements
- First-ride-only promotions
- Track usage count

### 8. Support Tickets
- View customer/driver complaints
- Filter by status (Open, In Progress, Resolved)
- Link tickets to specific trips
- Add resolution notes

### 9. Settings
- General business settings (name, currency, timezone)
- Trips & Dispatch configuration (auto/manual dispatch, radius, timeout)

---

## Demo Data Included

| Data | Count | Details |
|------|-------|---------|
| Drivers | 3 | Ahmed, Raj, Maria — with ratings and trip history |
| Vehicles | 4 | Camry, CR-V, Caravan + 1 unassigned Hyundai Ioniq |
| Zones | 4 | Downtown Core, Pearson Airport, North York, Mississauga |
| Fare Rules | 4 | Sedan, SUV, Luxury, Accessible — each with full pricing |
| Promo Codes | 3 | FIRST50 (50% off), AIRPORT10 ($10 off), WEEKEND20 (20% off) |
| Trips | 4+ | Mix of completed and active trips |
| Support Tickets | 1 | Sample billing dispute |

---

## Coming Soon (Not in This Demo)

### Google Maps Integration
- Live driver tracking on map
- Route visualization (pickup to dropoff)
- ETA calculations
- Geofenced zone boundaries on map
- Heatmap of ride demand

> *Maps integration requires Google Maps Platform API key configuration — will be activated based on brand requirements.*

### Customer / Rider App
- The customer-facing ride booking app will be provided separately
- It will be **brand-specific** — customized with your company name, logo, colors, and branding
- Features include: ride booking, fare estimate, driver tracking, ride history, ratings, promo codes, payment
- Detailed discussion on customer app scope, design, and timeline will follow

### Driver Mobile App
- Dedicated mobile experience for drivers
- Accept/reject ride requests, navigation, earnings dashboard
- Currently, driver login is available at the web URL above

---

