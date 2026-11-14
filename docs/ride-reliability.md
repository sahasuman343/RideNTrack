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
- GPS uses high-accuracy fixes with a 5-second time interval and 15-metre distance threshold. These are starting values to validate on physical devices, not a guarantee that Android delivers fixes at an exact cadence.
- Uploads run on reconnect, foreground resume, every 30 seconds while the screen is mounted, and from GPS background callbacks. Alerts are batch-upserted; each location sync pass is capped at five batches of up to 100 records to bound background work. Failures retain local events and are shown in the UI.
- Location uploads and alerts use stable IDs. Repeated delivery is safe.
- Alerts are read from the database and refreshed after reconnect. No ephemeral broadcast is needed for delivery.
- Private Presence channels provide live updates; an initial/reconnect snapshot and a 60-second member/location reconciliation recover missed data. Alert changes refresh only alerts instead of reloading all ride metadata. Names come from a restricted membership RPC, not public profile records.
- Mobile maps retain last-known positions, mark fixes older than 30 seconds as stale, and update from GPS samples without per-frame JavaScript marker animation. Route requests use simplified geometry to reduce payload and native map-source work. Follow and fit-group controls are explicit.
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


## Low-end Android performance validation
The optimization branch targets entry-level Android devices with 2–3 GB RAM. This is a test target, not a verified compatibility claim until physical-device measurements are recorded.

Run the same 3–4 hour ride scenario on an entry-level device and a 6–8 GB reference device:
- Keep the screen locked for at least 75% of the ride; confirm the OS location indicator and background service remain active.
- Test 1, 5, 20 and 50 riders; record map responsiveness, dropped frames, memory growth and crash/ANR events.
- Repeat with strong network, intermittent connectivity and a 10-minute offline period; verify queued GPS points and alerts drain without duplicates after reconnect.
- Record battery percentage at start/end, device model, Android version, screen state, GPS interval, network condition and ride duration.
- Capture Android Studio/Perfetto memory and frame-time traces. Compare median and p95 JS/UI frame time, peak and post-GC memory, network request count and battery drain per hour.
- Treat the optimization as accepted only if tracking reliability is unchanged and the low-end device shows lower CPU/network work without sustained memory growth or UI stalls.

Do not use emulator-only results as evidence of low-end device compatibility. Background location and vendor battery-management behavior must be checked on physical hardware.
