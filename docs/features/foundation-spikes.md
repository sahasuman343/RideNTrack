# Foundations spikes (R3)

Short notes on the three things the plan wanted checked before Phase 2 builds
on them. Each lists what we will do and what needs a real device or a store
decision.

## 1. Offline map packs (F5)

- `@rnmapbox/maps` supports `offlineManager.createPack` with a bounds or
  geometry, zoom range and style URL. Packs are per style, so a theme change
  means a second pack; we will download only the current style.
- We download a corridor, not a bounding box: buffer the route line by
  ~5 km (zoom 8 to 14) and a narrower ~1 km band (to zoom 16). A 600 km
  Himalayan route comes to roughly 150 to 250 MB at those zooms; the app shows
  the estimate before downloading and requires Wi-Fi by default.
- Mapbox caps offline tiles per device (6,000 tiles by default on the free
  tier, more on paid). The pack sizing in F5 stays under that cap and tells
  the rider when a route is too long to save in one go.
- Needs a device test: download over mobile data, airplane mode, reopen.

## 2. Crash detection sensor sampling (F7)

- Expo's `expo-sensors` Accelerometer only delivers while the JS thread runs,
  so it stops when the screen is locked on most Android phones. For the beta
  we sample only while the ride screen is open and the screen is on (keep
  awake during a ride), which covers most riders who mount the phone.
- For locked-screen detection we need a small native module that samples the
  accelerometer inside the existing location foreground service on Android
  and posts candidates to JS. iOS cannot sample in the background without a
  workout or navigation session, so iOS stays foreground-only.
- The detector is a pure function over a rolling window (impact over ~4 g,
  then near-stillness for 10 s, then no movement over ~5 km/h). It is tuned
  offline from `crash_telemetry` samples, which is why the recorder ships
  first behind `sensor_recorder`.

## 3. Store policies for alerts

- Android SMS permission: Play only allows `SEND_SMS` for default SMS apps or
  approved exceptions. We keep using the SMS composer intent on the phone and
  send automatic SMS from the server (F6), so no SMS permission is needed.
- Android full-screen intent (`USE_FULL_SCREEN_INTENT`): from Android 14 it is
  granted by default only to calling and alarm apps. A crash countdown is a
  reasonable use but Play may still require a declaration form. Fallback: a
  high-priority heads-up notification with the countdown.
- Apple critical alerts: need a special entitlement request to Apple with a
  justification. Until granted we use time-sensitive notifications, which are
  allowed without approval.
- Suman's actions: submit the Play full-screen intent declaration and the Apple
  critical alerts entitlement request when F7 is ready for beta.
