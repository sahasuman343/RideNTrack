# RideNTrack — Project Overview

## 1. Purpose

RideNTrack is a motorcycle touring and group-ride companion platform designed to keep riding packs coordinated, informed, and safe from initial trip planning through post-ride settlement.

Generic navigation apps focus on getting a single driver from A to B, and generic chat apps scatter routes, live locations, expenses, and safety alerts across noisy threads. RideNTrack unifies the entire motorcycle expedition lifecycle around three core principles:

- **Glanceable, Glove-Friendly Riding UX:** High-contrast outdoor readability for handlebar-mounted phones, oversized touch targets, and hands-off safety alerts that work alongside external turn-by-turn navigation apps.
- **Dead-Zone & Background Resilience:** Motorcycle tours routinely cross mountain passes and rural highways with poor cellular coverage. RideNTrack captures location history locally offline, preserves last-known rider visibility, and synchronizes reliably once signal returns.
- **Safety-First Group Accountability:** Joining any ride and accessing core emergency/SOS tools remain free for every rider, while organizers can coordinate large multi-day packs, track pack fuel limits, and share read-only live progress links with family back home.

---

## 2. Features

### A. Trip Planning & Touring Intelligence
- **Multi-Day Expedition Planner:** Organize single-day rides or multi-day tours with dated days, riding stages, overnight stays, and categorized stops (fuel, food, chai/rest breaks, scenic viewpoints, repair/mechanics, meetup points, and accommodations).
- **Pack-Minimum Fuel Planning:** Evaluates motorcycle tank capacity, mileage, and reserve specifications across the riding group to calculate the pack's limiting range, recommended fuel interval, and required fuel stops.
- **Daylight & Terrain Pacing Advisories:** Applies conservative pacing multipliers based on route terrain (highway, mixed, or mountain ghats) and warns organizers when projected arrival approaches or passes sunset.
- **Weather & Road Condition Cautions:** Surfaces route weather forecasts and rider-contributed road/stop notes along the itinerary.
- **Two-Way GPX Support:** Import existing GPX routes, waypoints, and tracks into a trip or export planned routes and recorded GPS trails for offline GPS devices and external tools.
- **Shared Group Gear Checklist:** Pre-ride preparation checklists where riders can verify readiness and claim shared pack tools (such as puncture kits, inflators, first-aid, or tow straps).
- **Trip Cloning, Archiving & Discovery:** Clone past itineraries with shifted dates, archive completed tours, and browse or copy public community touring routes.

### B. Live Group Tracking & External Navigation Handoff
- **External Turn-by-Turn Handoff:** One-tap "Navigate Leg" handoff to Google Maps or Apple Maps, automatically slicing multi-stop itineraries into provider-compatible sequential legs so RideNTrack stays focused on group coordination rather than duplicating turn-by-turn routing.
- **Real-Time Group Map & Riding HUD:** Live map showing the planned route, each rider's recorded trail, live speed, covered distance, and distance to the next stop or regroup point.
- **Pack Formation & Separation Alerts:** Tracks each rider's linear progress along the route, highlights lead and sweep roles, and flags when the pack stretches beyond configured separation or route-deviation thresholds.
- **Background Tracking Survival & Audio Ducking:** Continuous background location tracking behind external maps apps, adaptive low-power cadence when parked, automatic arrival stop so home addresses are not broadcast unintentionally, Android battery-optimization readiness prompts, and transient audio ducking so alert chimes do not mute map voice guidance.
- **Dead-Zone Staleness Indicators:** Distinguishes active riders from stale or offline riders using "Last seen" indicators rather than abruptly hiding riders in cellular dead zones.

### C. Group Coordination & In-Ride Communication
- **Role-Based Pack Control:** Supports five pack roles (Captain, Co-Captain, Marshal, Sweeper, and Member), invite codes/expiring links, leadership transfer, and regroup-point arrival confirmations.
- **In-Ride Trip Chat:** Dedicated group messaging within the ride with pinned logistics (hotel/meetup details), glove-friendly one-tap quick replies (e.g., "Copy", "Stopping ahead", "Fuel needed"), and offline status awareness.
- **Broadcast Ride Alerts:** One-tap visual, audible, and haptic group notifications for fuel stops, breaks, road hazards, regrouping, mechanical breakdowns, and captain announcements with acknowledgement tracking.

### D. Safety, Emergency & Family Visibility
- **SOS & ICE Privacy Controls:** Prominent hold-to-confirm SOS trigger that broadcasts live GPS coordinates to the pack, prepares pre-filled emergency SMS messages, offers one-tap dialing to national emergency helplines, and lets riders opt in to sharing blood group and emergency contacts strictly with active ride participants.
- **Stationary Off-Route Safety Check-In:** Detects prolonged unexpected stops away from planned waypoints and prompts the rider with a countdown check-in before alerting the group's lead/sweep riders.
- **Mechanical Breakdown Directory:** Quick mechanical issue reporting paired with verified national highway assistance contacts.
- **Live Family Spectator Web Link:** Organizers can generate revocable, time-limited browser links so family members can watch the ride's route and live rider locations on a web map without installing the app or seeing private contact details.

### E. Post-Ride Memories, Expenses & Monetization
- **Group Expense & Fuel Ledger:** Log shared fuel, food, and stay expenses with equal or custom splits and automated minimal-transfer debt settlement.
- **Ride Journal & Analytics:** Record trip journal notes, odometer milestones, lifetime touring stats, and shareable ride recap cards.
- **2-Tier Monetization (Host-Unlocks-Group):**
  - **Free:** Joining any ride, live group map, offline GPS sync, external maps handoff, trip chat, and all SOS/safety tools remain free forever; free organizers can host up to 2-day rides, 5 waypoints, and 6 riders with 7-day location history.
  - **Pro Tourer (or per-trip Expedition Pass):** Unlocks unlimited multi-day tours, up to 50 waypoints, large packs (up to 50 riders), full touring intelligence, GPX import/export, shared expenses/journals, live family spectator links, and unlimited ride history—for the entire group hosted on that ride.

---

## 3. Architecture

RideNTrack uses a modular client–cloud architecture designed for reliability, strict data isolation, and low operational complexity:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                               │
│                                                                         │
│   Mobile App (iOS & Android)              Web Companion & Spectator     │
│   • Live HUD, Group Map & Chat            • Authenticated Ride Dashboard │
│   • Background GPS & Local Offline Queue  • Read-Only Family Tracking   │
│   • External Maps Handoff (Google/Apple)    (Public tracking links)       │
└───────────────────────────────┬─────────────────────────┬───────────────┘
                                │                         │
                                ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          SHARED DOMAIN CORE                             │
│                                                                         │
│   Pure TypeScript rules shared identically across Mobile & Web:         │
│   • Route & Leg Slicing      • GPX Import/Export  • Fuel & Pacing Math  │
│   • Expense Settlement       • Safety Heuristics  • Tier Entitlements   │
└─────────────────────────────────────────┬───────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      BACKEND & REALTIME PLATFORM                        │
│                                                                         │
│   Authentication & Identity   Managed PostgreSQL     Realtime Engine    │
│   • Token-based user auth     • Row-Level Security   • Ephemeral rider  │
│   • Encrypted device tokens   • Transactional RPCs     presence channel │
│                               • Automated retention  • Live alerts/chat │
│                                                                         │
│   Serverless Edge Functions & Storage                                   │
│   • Push notification dispatch (rate-limited)                           │
│   • Scheduled history retention cleanup (exempts Pro/Pass rides)        │
│   • Private user- and ride-scoped media storage                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Architectural Layers & Responsibilities
1. **Mobile Client:** Handles device sensors (foreground/background GPS), local durable storage for offline breadcrumbs and cached trip itineraries, native audio/haptic alerts, and deep-link handoff to external navigation apps.
2. **Web Client:** Provides a desktop/mobile browser dashboard for monitoring active group rides and a lightweight, public read-only spectator portal for family members via expiring share tokens.
3. **Shared Domain Core:** Centralizes all deterministic business logic—navigation leg slicing, fuel range calculations, daylight risk evaluation, GPX parsing/generation, expense splitting, freshness classification, and entitlement checks—so mobile, web, and automated verification stay consistent.
4. **Database & Authorization Boundary:** A single managed relational database serves as the source of truth for trips, itineraries, participants, messages, expenses, and GPS history. Every table enforces row-level security, membership is verified server-side, and multi-step workflows (trip creation, invitations, admissions, tier limits) run as atomic server procedures.
5. **Realtime & Asynchronous Sync:** Ephemeral rider coordinates flow over a private publish/subscribe presence channel for low-latency map updates, while durable breadcrumbs, alerts, and chat messages synchronize asynchronously with idempotent batch uploads when connectivity resumes.
6. **External Service Boundaries:** Mapping/geocoding tiles, weather forecasts, and push notification delivery are integrated behind clean boundaries, with sensitive credentials and retention/notification triggers isolated on the server side.
