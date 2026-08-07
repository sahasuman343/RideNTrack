# RideNTrack

A real-time motorcycle group ride tracking and coordination monorepo application designed for seamless group navigation across long-distance tours and remote regions with intermittent network connectivity.

---

## 🏗️ Repository Architecture

RideNTrack is organized as an **npm workspaces monorepo**:

```
RideNTrack/
├── shared/           # @ridentrack/shared - Centralized TypeScript domain interfaces & constants
├── mobile/           # Expo React Native App (iOS & Android) with Background GPS & Offline Sync
├── web/              # Next.js 16 Web Dashboard & Live Mapbox Ride Viewer
└── supabase/
    └── migrations/   # PostgreSQL schemas, RLS policies, and batch sync RPC functions
```

---

## ⚡ Prerequisites

- **Node.js**: `v18.0.0` or later (tested on Node v20/v22)
- **npm**: `v9.0.0` or later
- **Expo Go** (iOS / Android) or a physical mobile device / simulator
- **Supabase Account**: For PostgreSQL database, Realtime Presence & Broadcast channels
- **Mapbox Token**: For rendering map tiles and calculating directions

---

## 🚀 Quick Start

### 1. Clone & Install Monorepo Dependencies

From the root directory:

```bash
# Install all workspace packages in one command
npm install
```

---

### 2. Configure Environment Variables

#### **Mobile App (`mobile/.env`)**
Create or edit `mobile/.env`: 

```env
# Supabase
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Mapbox
EXPO_PUBLIC_MAPBOX_TOKEN=pk.your_mapbox_token
```

#### **Web App (`web/.env.local`)**
Create or edit `web/.env.local`:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

# Mapbox
NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_mapbox_token
```

---

### 3. Apply Database Migrations (Supabase)

Execute the SQL migration scripts in your **Supabase SQL Editor** in the following sequence:

1. `supabase/migrations/001_initial_schema.sql` — Sets up `profiles`, `rides`, `ride_participants`, `location_updates`, `alerts`, indexes, and RLS policies.
2. `supabase/migrations/002_offline_batch_sync.sql` — Deploys the `bulk_insert_location_updates` RPC for atomic offline breadcrumb syncing.
3. `supabase/migrations/003_auth_profiles_trigger.sql` — Auto-creates rider profiles upon signup via a `SECURITY DEFINER` trigger, resolving Row Level Security issues.

> [!TIP]
> **Disable "Confirm Email" for Development / Avoid Rate Limits:**
> Supabase free tier limits confirmation emails to ~3-4 per hour. To test signups seamlessly:
> 1. Go to your **Supabase Dashboard** > **Authentication** > **Providers** > **Email**.
> 2. Toggle **Confirm email** to **OFF** (Disabled).
> 3. Click **Save**. Signups will now succeed immediately with no email rate limit errors.

---

### 4. Running the Applications

#### **Run Mobile App (Expo)**
From the root directory:
```bash
npm run mobile
```
*Or navigate into `mobile/`:*
```bash
cd mobile
npm run start
```
- Press `i` to open iOS Simulator.
- Press `a` to open Android Emulator.
- Scan the QR code using the **Expo Go** app on your physical device.

#### **Run Web App (Next.js)**
From the root directory:
```bash
npm run web
```
*Or navigate into `web/`:*
```bash
cd web
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔍 Code Validation & Type Checking

To verify syntax and type synchronicity across all workspaces:

```bash
# Check Web
node node_modules/typescript/bin/tsc --project web/tsconfig.json --noEmit

# Check Mobile
node node_modules/typescript/bin/tsc --project mobile/tsconfig.json --noEmit

# Check Shared Types
node node_modules/typescript/bin/tsc shared/types.ts --noEmit
```

---

## ✨ Core Features & Implementation Highlights

### 1. 🛰️ Uninterrupted Background GPS Tracking
- Integrated with `expo-task-manager` and `expo-location`.
- Persistent Android Foreground Service notification (`"RideNTrack Live Ride"`).
- Background location and fetch modes on iOS (`UIBackgroundModes: ["location", "fetch"]`).
- Automatically falls back to high-accuracy foreground watching if background permissions are unavailable.

### 2. 📶 Offline / Low-Connectivity Buffering Engine
- **Local FIFO Queue (`offlineQueue.ts`)**: Automatically stores location breadcrumbs and alerts locally in `AsyncStorage` when traveling through dead zones.
- **Auto Sync Monitor (`useOfflineSync.ts`)**: Detects network connectivity via `@react-native-community/netinfo` and automatically drains the queue in batches via the `bulk_insert_location_updates` Supabase RPC as soon as connectivity resumes.
- **UI Connectivity Badges**: Live indicators on the ride screen show `GPS Active`, `Offline Mode (X buffered)`, or `Syncing...` with a tap-to-flush option.

### 3. 📦 `@ridentrack/shared` Type Package
- Single source of truth for `Ride`, `LocationUpdate`, `BufferedLocation`, `Alert`, `AlertType`, `ALERT_LABELS`, and `Profile` models ensuring 100% type synchronicity across client and server.
