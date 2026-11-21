# RideNTrack Feature Roadmap

This document is the implementation source of truth. Each phase is delivered as small reviewable commits on the feature branch, with matching migrations, tests, and feature documentation.

## Phase 0 — Foundation and Reliability
- [x] Profile management with motorcycle machine configurations (make, model, fuel tank, mileage, reserve, category).
- [x] Self-service account deletion with cascading cleanup across all user-owned rows (`migration 018`).
- [x] GPS background tracking reliability: distinct foreground service permission and manual start actions (`mobile/src/services/backgroundLocation.ts`).
- [x] Persistent SQLite queue with WAL mode, single-flight sync, and server acknowledgement (`mobile/src/services/syncQueue.ts`).
- [x] Full CI pipeline passing: TypeScript, 70/70 unit tests, ESLint, 21 database migrations, RLS access regression tests, production Turbopack web build, and Playwright Chromium map checks.

## Phase 1 — Trip Foundation & Complete Trip Management
- [x] Initial trip schema and workspace foundation (`PR #6`).
- [x] Atomic trip creation RPC (`create_trip_plan`).
- [x] Day assignment for waypoints (nullable FK and creation payload support).
- [x] Date and price validation at aggregate write boundary.
- [x] Itinerary edit/reorder and multiple stays (transactional RPCs, admin UI, and database regression coverage).
- [x] Full route editing workshop (origin/destination/place search, add/remove/reorder stops, day assignment, Mapbox route preview, and recalculated driving estimate; `migration 011`).
- [x] Leader-only trip deletion with explicit confirmation and cascading aggregate cleanup (`migration 012`).
- [x] Atomic trip archiving and unarchiving (`archive_trip`, `unarchive_trip`, `migration 019`).
- [x] Deep trip duplication with date-offset shifting for days, stages, waypoints, and stays (`duplicate_trip`, `migration 019`).
- [x] Cold-start offline trip caching using `AsyncStorage` in trip workspace.
- [x] Segmented trip status filtering (Active, Completed, Archived, Community) on the mobile home screen.

## Phase 2 — Group Ride Control Center
- [x] Trip invitations with expiry and acceptance state (`migration 009`, token-based acceptance, and targeted-email checks).
- [x] 5-tier touring role hierarchy: Captain, Co-Captain, Marshal, Sweeper, Member (`migration 020`).
- [x] Leadership transfer and captain participant removal RPCs (`transfer_trip_leadership`, `remove_trip_participant`, `migration 020`).
- [x] 10-point motorcycle pre-ride safety checklist with completion tracking (`trip_checklists`, `migration 020`).
- [x] Live/stale/offline rider status (persisted GPS freshness labels and live tracker indicators).
- [x] Configurable route-deviation (>250m) and rider-behind alerts with five-minute per-condition throttle.
- [x] Regroup points and arrival confirmation (`trip_regroup_points`, `trip_regroup_arrivals`, `migration 010`).
- [x] Privacy, membership, and RLS security regression tests (`tests/db-regression.sql`).

## Phase 3 — Live Group Tracking & Motorcycle Touring Intelligence
- [x] Live group map with planned route, recorded GPS trail, and real-time rider markers.
- [x] Riding HUD displaying live speed, total trail distance, and distance to next stop.
- [x] Real-time pack formation strip calculating orthogonal polyline distance, lead/sweep rider badges, and rider gaps (`shared/route.ts`).
- [x] Pack separation detection with automatic alerts when gaps exceed 1.5 km.
- [x] Motorcycle fuel feasibility engine calculating safe touring range, consumption, and recommended fuel stops (`shared/touring.ts`).
- [x] Weather forecast integration and motorcyclist road cautions (`shared/touring.ts`).

## Phase 4 — Smart Group Coordination
- [x] Captain announcements broadcast modal with touring presets and custom message input (`mobile/app/ride/[id].tsx`).
- [x] Quick alert triggers: break, fuel, mechanical, route deviation, regroup, announcement.
- [x] Waypoint auto-advance when arriving within 250m of next waypoint.
- [x] Regroup point proximity detection and arrival confirmation banner.

## Phase 5 — Safety and Emergencies
- [x] Direct red SOS emergency trigger on HUD and live action sheet.
- [x] One-touch broadcast of live GPS emergency alerts to all ride participants.
- [x] Direct emergency contact SMS with precise coordinates and Google Maps location link.
- [x] Phone dialer integration for emergency contact or local emergency services (112).
- [x] Emergency contact storage in rider profile with format validation.

## Phase 6 — Offline-First Experience
- [x] Offline trip details and stages cached locally via `AsyncStorage`.
- [x] Persistent SQLite location queue ensuring no GPS points are lost during cellular dead zones.
- [x] Server-side idempotent batch synchronization (`bulk_insert_location_updates`).
- [x] Automatic queue flush upon network restoration.

## Phase 7 — Memories, Expenses, and Community
- [x] GPX 1.1 route and recorded GPS trail exporter (`shared/gpx.ts`) with native file sharing.
- [x] Group expense tracking with custom/equal splits and category breakdown (`trip_expenses`, `migration 021`).
- [x] Greedy debt minimization settlement resolution algorithm (`shared/expenses.ts`).
- [x] Ride journal entries with photo attachments, odometer readings, and mood tags (`migration 017`).
- [x] Shareable touring recap card generator (`shared/journal.ts`).
- [x] Lifetime rider analytics and milestones banner (`get_rider_analytics`).
- [x] Public touring discovery feed and one-click community route cloning (`get_public_trips`).

## Release Gates & Guardrails
- [x] Zero TypeScript errors (`npm run typecheck`).
- [x] Zero ESLint warnings or errors (`npm run lint`).
- [x] 100% test pass rate across all 70 unit and integration tests (`npm test`).
- [x] Database migrations 001–021 and RLS security regression checks pass on PostgreSQL 16 (`tests/db-regression.sql`).
- [x] Production web build passes with Next.js Turbopack (`npm --workspace=web run build`).
- [x] Playwright Chromium headless map checks pass (`tests/browser.cjs`).
- GPS/background reliability requires physical device testing; CI verifies software logic and contracts.
- Merges to `main` and production deployments remain subject to user approval.
