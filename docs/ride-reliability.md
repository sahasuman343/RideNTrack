# Ride reliability and map update

## Deployment order
1. Back up and apply migrations 001–005 in order to a staging Supabase project.
2. Deploy the updated web client and mobile development builds together. Migration 005 changes the batch upload contract to require a persistent client_id; old clients should be upgraded before normal use resumes.
3. Configure the Supabase URL, publishable/anon key, and Mapbox public token in each client.
   In Supabase Realtime Settings, disable **Allow public access** so ride Presence subscriptions must use the private-channel authorization policies from migration 005.
4. Build native mobile apps for Mapbox and background GPS. Expo Go provides a foreground-only fallback. The existing Mapbox native download-token placeholder in app.json must be configured securely for a native build.
5. Verify with two signed-in riders before production rollout. No production migration is applied by this pull request.

## Behavior
- GPS is collected only during an active ride while sharing is enabled. Leaving the ride screen, pausing, signing out, or receiving a completed status stops collection.
- The active ride context is persisted for OS background task callbacks. OS force-stop and vendor battery restrictions can still stop tracking.
- SQLite stores queued events atomically and migrates old AsyncStorage queues once. Events are scoped to the signed-in account. There is no silent 2,000-point truncation.
- Uploads run on reconnect, foreground resume, every ten seconds while the screen is mounted, and from GPS background callbacks. Failures retain the local events and are shown in the UI.
- Location uploads and alerts use stable IDs. Repeated delivery is safe.
- Alerts are read from the database and refreshed after reconnect. No ephemeral broadcast is needed for delivery.
- Private Presence channels provide live updates; periodic database snapshots recover missed data. Names come from a restricted membership RPC, not public profile records.
- Maps retain last-known positions, mark fixes older than 30 seconds as stale, animate movement, and let users pan freely. Follow and fit-group controls are explicit.
- Camera padding follows the mobile panel height so selected riders remain visible. Web map gestures release follow mode; changing ride URLs resets ride-specific state.

## Verification
Run with Node 24:
- npm ci --ignore-scripts
- npm run typecheck
- npm test
- npm run lint
- npm --workspace=web run build (with public client environment variables)

The GitHub workflow also applies migrations to disposable PostgreSQL and checks profile privacy, invite-only joins, member access, private Presence policies, and duplicate uploads. Chromium checks cover desktop/mobile map size, follow/manual zoom, panel clearance, search, invitation copying, alert dismissal, offline aging, ride switching, and dashboard navigation. Browser tests use mocked Supabase and Mapbox responses; production tile delivery and multi-device Realtime still need staging verification. Screenshots are uploaded as workflow artifacts.

## Device acceptance checks
- Two riders: create, join by code, start, pan/follow, alert, end.
- Airplane mode: keep moving, send an alert, reconnect; confirm queue drains and history has no duplicate client IDs.
- Deny GPS permission; retry from Settings. Test foreground fallback and background location in a native build.
- Lock screen, resume app, leave ride screen, and sign out; confirm the OS location indicator matches the UI.
- End the ride from another device; connected clients stop GPS; offline clients stop after receiving the update.
- Sign into a different account: the previous account's queue must not be uploaded or removed.
- Web at phone and desktop widths: rider search, follow marker, fit group, offline banner, alert dismissal, keyboard controls.
