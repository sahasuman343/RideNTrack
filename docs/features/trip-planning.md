# Feature: Trip planning foundation

**Status:** Phase 1 in progress  
**Owner module:** `mobile/src/features/trips` (target structure)  
**Database aggregate:** `public.rides`

## User outcome
A rider can create a multi-day motorcycle trip with a route, ordered places, itinerary days and an initial stay. The trip must be persisted atomically.

## Current implementation
- Trip metadata is stored on `rides`.
- Ordered planned locations are stored in `trip_waypoints`.
- Day records are stored in `trip_days`.
- Accommodation records are stored in `trip_stays`.
- Mapbox supplies place search and a driving-route estimate.
- Trip workspace displays the itinerary and links to the live ride tracker.

## Phase 1 design
- Treat `rides` as the trip aggregate root.
- Use one PostgreSQL RPC to insert the ride, days, waypoints and optional initial stay in a single transaction.
- Associate a waypoint with a day through nullable `trip_day_id`; unassigned stops remain valid until the itinerary editor is implemented.
- Preserve provider place IDs and coordinates.
- Keep provider driving ETA labelled as a driving estimate, not a motorcycle ETA.
- Validate date strings and numeric amounts before submission; database constraints remain authoritative.

## Authorization
- Only an authenticated user can create a trip.
- The RPC sets `admin_id` from `auth.uid()`; clients cannot create a trip on behalf of another user.
- Existing trip-member read and ride-admin write policies continue to apply to child records.

## Failure handling
The RPC is transactional. Any invalid child record or failed insert rolls back the parent trip and every child record. The client should display the RPC error and allow retry.

## Acceptance criteria
- [ ] A valid trip creates its parent and all supplied child rows.
- [ ] A failure in any child insert leaves no parent or child rows.
- [ ] The authenticated caller becomes the trip admin and participant through the existing trigger.
- [ ] Waypoint order is preserved.
- [ ] Day and stay relationships are valid.
- [ ] Invalid date ranges and invalid prices are rejected.
- [ ] Existing live ride tracking remains compatible.

## Next increments
1. Itinerary editor: assign/move/reorder waypoints by day.
2. Multiple stays per trip day.
3. Trip event timeline for actual arrival/departure.
4. Offline itinerary edits with version checks.
