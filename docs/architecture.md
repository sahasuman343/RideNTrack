# RideNTrack Architecture

## Product boundary
RideNTrack is a motorcycle-trip lifecycle product. A trip is the aggregate root; its planned itinerary, participants, live ride session, events, stays, expenses and memories are related capabilities.

## Current stack
- Mobile: Expo / React Native, Expo Router, TypeScript.
- Shared domain contracts: `shared/`.
- Identity and persistence: Supabase Auth and PostgreSQL.
- Live group state: Supabase Realtime Presence and database change subscriptions.
- Maps and place search: Mapbox.
- Offline persistence: SQLite queue on device.
- Deployments: EAS for mobile; existing web deployment workflow.

Do not introduce a separate FastAPI service, Redis, Kafka or microservices without a measured requirement. Keep the current Supabase architecture until a workload demonstrates a need to split it.

## Domain modules
1. Trips: trip lifecycle, metadata and itinerary.
2. Group rides: expiring token invitations, membership roles (leader/sweep/rider), roster and rider coordination.
3. Location: foreground/background GPS lifecycle and validation.
4. Realtime: ephemeral presence, subscriptions and reconnect reconciliation.
5. Sync: durable offline queue, idempotency and conflict handling.
6. Touring intelligence: deterministic daily riding and fuel feasibility calculations.
7. Memories: trip events, local media metadata and trip recap.
8. Discovery: community-verified places and road reports.

## Data ownership
- `rides` remains the trip aggregate root for backward compatibility.
- Planned route data lives in `trip_waypoints`, `trip_days` and `trip_stays`.
- Actual actions belong in append-oriented `trip_events`; do not infer actual stops solely from the planned itinerary.
- `location_updates` is persisted GPS history; Realtime Presence is ephemeral current position.
- Media originals remain device-local. Cloud stores metadata only, consistent with the current product constraint.

## Interaction patterns
- Supabase client queries for ordinary authenticated reads.
- PostgreSQL RPC for atomic multi-table writes and privileged state transitions.
- Realtime Presence for live positions; Postgres changes for durable alerts and trip state.
- SQLite for offline writes, with client-generated idempotency IDs and retry-safe batch sync.
- External provider secrets must only be used server-side. Public Mapbox client tokens are not secrets.

## Security invariants
- Every trip-owned table has RLS.
- Membership is checked in the database, not trusted from client UI.
- Public discovery never exposes live GPS, private contact details or private trip metadata.
- Leaving/completing a trip stops location publication.
- Closing the live-ride screen does not stop sharing; the app shows a persistent "Sharing your location" bar with a Stop action until sharing ends.
- Only the ride leader broadcasts rider-behind alerts; a lagging rider sees a local notice.
- Stale positions are visibly stale; never present cached coordinates as live.
- Users can stop sharing and delete their trip data.

## Engineering rules
- Keep GPS lifecycle out of screen components.
- Keep planned itinerary separate from actual events.
- Use migrations for all schema changes; never make ad-hoc production schema changes.
- Use transactions for aggregate writes.
- Add regression tests for RLS, idempotency, date boundaries and offline recovery.
- Document each feature's state model, permissions, failure modes and acceptance criteria in `docs/features/`.
