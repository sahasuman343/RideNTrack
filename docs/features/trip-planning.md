# Feature: Trip planning foundation

**Status:** Phase 1 implementation complete; CI verification pending  
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
- Trip admins can reorder waypoints, move them between itinerary days, and save the complete itinerary transactionally.
- Trip admins can add multiple accommodation records, optionally associated with a trip day.

## Phase 1 design
- Treat `rides` as the trip aggregate root.
- Use one PostgreSQL RPC to insert the ride, days, waypoints and optional initial stay in a single transaction.
- Associate a waypoint with a day through nullable `trip_day_id`; unassigned stops remain valid.
- `save_trip_itinerary` validates the full waypoint set and applies sequence/day changes in one transaction.
- `add_trip_stay` validates stay details and adds accommodation without replacing existing stays.
- Preserve provider place IDs and coordinates.
- Keep provider driving ETA labelled as a driving estimate, not a motorcycle ETA.
- Validate date strings and numeric amounts before submission; database constraints remain authoritative.

## Authorization
- Only an authenticated user can create a trip.
- The RPC sets `admin_id` from `auth.uid()`; clients cannot create a trip on behalf of another user. Execute permission is explicitly revoked from both PUBLIC and anon, then granted only to authenticated users.
- Existing trip-member read and ride-admin write policies continue to apply to child records.

## Failure handling
The RPC is transactional. Any invalid child record or failed insert rolls back the parent trip and every child record. The client should display the RPC error and allow retry.

## Acceptance criteria
- [x] A valid trip creates its parent and all supplied child rows (database regression test added).
- [x] A failure in any child insert leaves no parent or child rows (rollback regression test added).
- [x] The authenticated caller becomes the trip admin and participant through the existing trigger (asserted in database regression test).
- [x] Waypoint order is preserved by the sequence field.
- [x] Day and stay relationships are valid; waypoints can reference a trip day.
- [x] Invalid date ranges and negative stay prices are rejected at the database write boundary.
- [x] Existing live ride tracking remains compatible; trip planning remains a separate data aggregate layered over the existing ride parent.

## Phase 1 editor behaviour
- Reordering swaps displayed positions and saves a complete ordered waypoint set; the database temporarily moves sequences out of range to avoid unique-key collisions.
- Day assignment is optional and validated against a day belonging to the same trip.
- Multiple stays are supported per trip and can be linked to a trip day.
- Only the trip admin can use the editing controls; database RPCs independently enforce admin ownership.
- Actual arrival/departure events and offline conflict resolution are intentionally deferred to later phases.
